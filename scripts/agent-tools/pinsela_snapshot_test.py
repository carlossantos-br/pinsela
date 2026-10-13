#!/usr/bin/env python3
"""pinsela_snapshot_test — visual regression testing for Pinsela docs.

Workflow:
    1. `update <doc.json> [--name foo]` renders the doc and saves the PNG
       under `baselines/<name>.png`. Also writes `baselines/<name>.meta.json`
       with the source-doc path.
    2. `check <doc.json> [--name foo] [--threshold 0.01]` renders the doc and
       compares against the baseline. Exits non-zero if pixel-diff exceeds
       threshold (default 1%).
    3. `list` shows registered baselines.
    4. `all [--threshold 0.01]` checks every baseline whose meta.json has a
       `doc_path` that still exists. Useful as a pre-commit gate.

If the doc has not been rendered before, `check` exits with a clear message
suggesting `update`.

Rendering goes through the existing `render_local.py` helper in this dir,
which POSTs to /api/agent/render. If the local API is down, the tool will
print an error and exit non-zero.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
BASELINES_DIR = HERE / "baselines"
RENDER_LOCAL = HERE / "render_local.py"


def _slug(doc_path: Path) -> str:
    # default name: file stem + short hash of absolute path
    h = hashlib.md5(str(doc_path.resolve()).encode("utf-8")).hexdigest()[:6]
    return f"{doc_path.stem}-{h}"


def _ensure_dir() -> None:
    BASELINES_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_python() -> str:
    """Prefer the Pinsela API venv (has httpx + Pillow). Fallback to system python3."""
    venv_py = Path("apps/api/.venv/bin/python")
    if venv_py.is_file():
        return str(venv_py)
    return "python3"


def _render(doc_path: Path, out_png: Path) -> None:
    if not RENDER_LOCAL.exists():
        raise SystemExit(f"error: render_local.py missing at {RENDER_LOCAL}")
    py = _resolve_python()
    cmd = [py, str(RENDER_LOCAL), str(doc_path), "--out", str(out_png)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stdout + "\n" + res.stderr + "\n")
        raise SystemExit(f"error: render failed ({res.returncode})")


def _load_png_rgba(path: Path):
    from PIL import Image  # local import to keep startup lean

    img = Image.open(path).convert("RGBA")
    return img


def _diff_ratio(a, b) -> float:
    from PIL import Image, ImageChops

    if a.size != b.size:
        b = b.resize(a.size)
    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    if bbox is None:
        return 0.0
    # mean per-pixel absolute difference normalised to 0..1
    histogram = diff.convert("L").getdata()
    total = sum(histogram)
    pixels = a.size[0] * a.size[1]
    return total / (pixels * 255.0)


def _meta_path(name: str) -> Path:
    return BASELINES_DIR / f"{name}.meta.json"


def _png_path(name: str) -> Path:
    return BASELINES_DIR / f"{name}.png"


# --------------------------------------------------------------------------- #
# Subcommands.
# --------------------------------------------------------------------------- #

def cmd_update(args: argparse.Namespace) -> int:
    _ensure_dir()
    doc = Path(args.doc).resolve()
    if not doc.exists():
        print(f"error: doc not found: {doc}", file=sys.stderr)
        return 2
    name = args.name or _slug(doc)
    out = _png_path(name)
    _render(doc, out)
    meta = {
        "name": name,
        "doc_path": str(doc),
        "png_path": str(out),
    }
    _meta_path(name).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"baseline updated: {name}")
    print(f"  png : {out}")
    print(f"  meta: {_meta_path(name)}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    _ensure_dir()
    doc = Path(args.doc).resolve()
    if not doc.exists():
        print(f"error: doc not found: {doc}", file=sys.stderr)
        return 2
    name = args.name or _slug(doc)
    baseline = _png_path(name)
    if not baseline.exists():
        print(f"error: no baseline for {name!r}; run `update` first", file=sys.stderr)
        return 4

    tmp = BASELINES_DIR / f"{name}.candidate.png"
    _render(doc, tmp)
    a = _load_png_rgba(baseline)
    b = _load_png_rgba(tmp)
    ratio = _diff_ratio(a, b)
    threshold = args.threshold

    if ratio > threshold:
        print(f"FAIL  {name}  diff={ratio:.4%}  threshold={threshold:.2%}")
        print(f"  baseline : {baseline}")
        print(f"  candidate: {tmp}")
        return 1
    print(f"OK    {name}  diff={ratio:.4%}  threshold={threshold:.2%}")
    try:
        tmp.unlink()
    except OSError:
        pass
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    _ensure_dir()
    metas = sorted(BASELINES_DIR.glob("*.meta.json"))
    if not metas:
        print("(no baselines yet)")
        return 0
    print(f"{'NAME':<40} DOC")
    print("-" * 100)
    for m in metas:
        try:
            data = json.loads(m.read_text(encoding="utf-8"))
            print(f"{data.get('name', m.stem):<40} {data.get('doc_path', '?')}")
        except Exception:
            print(f"{m.stem:<40} (corrupt meta)")
    return 0


def cmd_all(args: argparse.Namespace) -> int:
    _ensure_dir()
    metas = sorted(BASELINES_DIR.glob("*.meta.json"))
    if not metas:
        print("(no baselines to check)")
        return 0
    bad = 0
    for m in metas:
        data = json.loads(m.read_text(encoding="utf-8"))
        doc_path = Path(data.get("doc_path", ""))
        if not doc_path.exists():
            print(f"SKIP  {data['name']}  doc gone: {doc_path}")
            continue
        ns = argparse.Namespace(doc=str(doc_path), name=data["name"], threshold=args.threshold)
        rc = cmd_check(ns)
        if rc != 0:
            bad += 1
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="pinsela_snapshot_test", description="Visual regression testing for Pinsela docs.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("update", help="Render and save as baseline")
    p.add_argument("doc")
    p.add_argument("--name")
    p.set_defaults(fn=cmd_update)

    p = sub.add_parser("check", help="Compare to baseline")
    p.add_argument("doc")
    p.add_argument("--name")
    p.add_argument("--threshold", type=float, default=0.01)
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("list", help="List registered baselines")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("all", help="Check every registered baseline")
    p.add_argument("--threshold", type=float, default=0.01)
    p.set_defaults(fn=cmd_all)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
