#!/usr/bin/env python3
"""pinsela_canvas — CLI for manipulating PinselaTemplateDocV1 JSON docs.

Designed for agent use: every command prints something useful, every error
is actionable, and the doc file is always pretty-printed JSON suitable for
`git diff`. Modifying commands write a `<path>.bak` next to the original by
default (disable with --no-backup).

If running this directly fails to import the pydantic-based validator (because
your shell's Python doesn't have pydantic), the script will fall back to a
pure-stdlib structural validator. To get the full validator + httpx + Pillow,
invoke via the API's venv:

    apps/api/.venv/bin/python \
        scripts/agent-tools/pinsela_canvas.py ...

The `pinsela_canvas` wrapper script next to this file does that automatically.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# Allow this file to be invoked directly without packaging.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import pinsela_canvas_ops as ops  # noqa: E402


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #

def _fail(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def _autotype(value: str) -> Any:
    """Best-effort scalar coercion for --set key=value pairs."""
    if value == "null":
        return None
    if value == "true":
        return True
    if value == "false":
        return False
    # quoted string?
    if len(value) >= 2 and ((value[0] == value[-1] == '"') or (value[0] == value[-1] == "'")):
        return value[1:-1]
    # int / float
    try:
        if "." not in value and "e" not in value.lower():
            return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


def _parse_set_pairs(pairs: list[str]) -> dict:
    out: dict = {}
    for raw in pairs or []:
        if "=" not in raw:
            _fail(f"--set expects key=value, got {raw!r}")
        k, v = raw.split("=", 1)
        k = k.strip()
        if not k:
            _fail(f"--set key empty in {raw!r}")
        patch_fragment = ops._expand_dot_path(k, _autotype(v))
        out = ops.deep_merge(out, patch_fragment)
    return out


def _parse_vars(pairs: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in pairs or []:
        if "=" not in raw:
            _fail(f"--vars expects key=value, got {raw!r}")
        k, v = raw.split("=", 1)
        out[k.strip()] = v
    return out


def _print_json(obj: Any) -> None:
    json.dump(obj, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


def _load_or_fail(path: str) -> dict:
    try:
        return ops.load_doc(path)
    except FileNotFoundError as exc:
        _fail(str(exc))
    except json.JSONDecodeError as exc:
        _fail(f"{path}: invalid JSON ({exc})")
    return {}  # unreachable


def _save_or_fail(path: str, doc: dict, backup: bool) -> None:
    out_path = ops.save_doc(path, doc, backup=backup)
    print(f"wrote {out_path}")


# --------------------------------------------------------------------------- #
# Commands.
# --------------------------------------------------------------------------- #

def cmd_new(args: argparse.Namespace) -> None:
    try:
        w_str, h_str = str(args.canvas).lower().split("x")
        w, h = int(w_str), int(h_str)
    except Exception:
        _fail(f"--canvas must be like 1080x1080 (got {args.canvas!r})")
    doc = ops.empty_doc(width=w, height=h, background=args.bg)
    ok, err = ops.validate(doc)
    if not ok:
        _fail(f"generated doc failed validation: {err}", code=3)
    out = Path(args.out)
    if out.exists() and not args.force:
        _fail(f"{out} already exists (use --force to overwrite)")
    _save_or_fail(str(out), doc, backup=not args.no_backup)


def cmd_validate(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    ok, err = ops.validate(doc)
    if ok:
        engine = "pydantic" if ops._HAS_NATIVE_VALIDATOR else "structural-fallback"
        print(f"OK  ({engine})")
        return
    print(f"INVALID: {err}", file=sys.stderr)
    sys.exit(1)


def cmd_summarize(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    print(ops.summarize(doc))


def cmd_tree(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    print(ops.tree(doc))


def cmd_find(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    if not any([args.by_name, args.by_kind, args.by_id]):
        _fail("find requires at least one of --by-name / --by-kind / --by-id")
    matches = ops.find(doc, by_name=args.by_name, by_kind=args.by_kind, by_id=args.by_id)
    if args.json:
        _print_json(matches)
        return
    if not matches:
        print("(no matches)")
        return
    for n in matches:
        print(ops._node_summary_line(n))


def cmd_patch(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    patch: dict = {}
    if args.json:
        try:
            j = json.loads(args.json)
        except json.JSONDecodeError as exc:
            _fail(f"--json invalid: {exc}")
        if not isinstance(j, dict):
            _fail("--json must decode to an object")
        patch = ops.deep_merge(patch, j)
    if args.set:
        patch = ops.deep_merge(patch, _parse_set_pairs(args.set))
    if not patch:
        _fail("patch needs --set key=value... or --json '<json>'")
    try:
        ops.patch(doc, args.node_id, patch)
    except KeyError as exc:
        _fail(str(exc))
    ok, err = ops.validate(doc)
    if not ok and not args.allow_invalid:
        _fail(f"resulting doc failed validation: {err}\n(use --allow-invalid to write anyway)", code=3)
    _save_or_fail(args.path, doc, backup=not args.no_backup)
    print(f"patched node {args.node_id}")


def cmd_add(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    props: dict | None = None
    if args.props:
        try:
            props = json.loads(args.props)
        except json.JSONDecodeError as exc:
            _fail(f"--props invalid: {exc}")
        if not isinstance(props, dict):
            _fail("--props must decode to an object")
    try:
        new_id = ops.add(doc, args.parent_id, args.kind, name=args.name, props=props)
    except (KeyError, ValueError) as exc:
        _fail(str(exc))
    ok, err = ops.validate(doc)
    if not ok and not args.allow_invalid:
        _fail(f"resulting doc failed validation: {err}\n(use --allow-invalid to write anyway)", code=3)
    _save_or_fail(args.path, doc, backup=not args.no_backup)
    print(f"added {args.kind} as {new_id} under {args.parent_id}")


def cmd_remove(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    try:
        ops.remove(doc, args.node_id)
    except (KeyError, ValueError) as exc:
        _fail(str(exc))
    ok, err = ops.validate(doc)
    if not ok and not args.allow_invalid:
        _fail(f"resulting doc failed validation: {err}\n(use --allow-invalid to write anyway)", code=3)
    _save_or_fail(args.path, doc, backup=not args.no_backup)
    print(f"removed {args.node_id} (and any descendants)")


def cmd_reorder(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    if sum(bool(x) for x in (args.delta is not None, args.to_front, args.to_back)) != 1:
        _fail("reorder needs exactly one of --delta N, --to-front, --to-back")
    try:
        ops.reorder_z(doc, args.node_id, delta=args.delta, to_front=args.to_front, to_back=args.to_back)
    except KeyError as exc:
        _fail(str(exc))
    _save_or_fail(args.path, doc, backup=not args.no_backup)
    print(f"reordered {args.node_id}")


def cmd_clone(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    dx, dy = 0.0, 0.0
    if args.offset:
        try:
            xs, ys = args.offset.split(",")
            dx, dy = float(xs), float(ys)
        except Exception:
            _fail("--offset must be 'dx,dy' (e.g. 40,40)")
    try:
        new_id = ops.clone(doc, args.node_id, offset=(dx, dy))
    except (KeyError, ValueError) as exc:
        _fail(str(exc))
    ok, err = ops.validate(doc)
    if not ok and not args.allow_invalid:
        _fail(f"resulting doc failed validation: {err}", code=3)
    _save_or_fail(args.path, doc, backup=not args.no_backup)
    print(f"cloned {args.node_id} -> {new_id}")


def cmd_apply_pattern(args: argparse.Namespace) -> None:
    doc = _load_or_fail(args.path)
    vars_map = _parse_vars(args.vars) if args.vars else {}
    try:
        ops.apply_pattern(doc, args.pattern, args.at, vars=vars_map)
    except (KeyError, ValueError, FileNotFoundError) as exc:
        _fail(str(exc))
    ok, err = ops.validate(doc)
    if not ok and not args.allow_invalid:
        _fail(f"resulting doc failed validation: {err}\n(use --allow-invalid to write anyway)", code=3)
    _save_or_fail(args.path, doc, backup=not args.no_backup)
    print(f"applied pattern {args.pattern!r} under {args.at}")


def cmd_diff(args: argparse.Namespace) -> None:
    a = _load_or_fail(args.path_a)
    b = _load_or_fail(args.path_b)
    print(ops.diff(a, b))


def cmd_render(args: argparse.Namespace) -> None:
    try:
        import httpx  # type: ignore
    except ImportError:
        _fail(
            "httpx required for render. Install it, or invoke via "
            "apps/api/.venv/bin/python "
            "(which has it)."
        )
        return

    doc = _load_or_fail(args.path)
    bg = args.bg
    payload = {"doc": doc, "scale": float(args.scale), "bg": bg}

    endpoints = [args.api.rstrip("/")]
    if args.api.rstrip("/") != "http://localhost:8201":
        endpoints.append("http://localhost:8201")

    last_err: str | None = None
    response_bytes: bytes | None = None
    used_endpoint: str | None = None
    for base in endpoints:
        url = f"{base}/api/agent/render"
        try:
            with httpx.Client(timeout=60.0) as client:
                r = client.post(url, json=payload)
            if r.status_code == 200:
                ct = r.headers.get("content-type", "")
                if "image/" in ct:
                    response_bytes = r.content
                else:
                    try:
                        j = r.json()
                        b64 = j.get("png_base64") or j.get("image_base64")
                        if b64:
                            import base64
                            response_bytes = base64.b64decode(b64)
                    except Exception:
                        pass
                if response_bytes is None:
                    last_err = f"{url}: 200 OK but no PNG bytes in response"
                    continue
                used_endpoint = url
                break
            else:
                last_err = f"{url}: HTTP {r.status_code} {r.text[:200]}"
        except httpx.HTTPError as exc:
            last_err = f"{url}: {exc}"

    if response_bytes is None or used_endpoint is None:
        _fail(f"render failed: {last_err}")
        return

    out_path = Path(args.out) if args.out else Path(str(args.path) + ".preview.png")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(response_bytes)

    width = height = None
    try:
        from PIL import Image  # type: ignore
        with Image.open(out_path) as im:
            width, height = im.size
    except Exception:
        pass

    size_info = f"  {width}x{height}px" if width else ""
    print(f"rendered via {used_endpoint}")
    print(f"  -> {out_path}{size_info}  ({len(response_bytes)} bytes)")


def cmd_extract_palette(args: argparse.Namespace) -> None:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        _fail(
            "Pillow required for extract-palette. Install it, or invoke via "
            "apps/api/.venv/bin/python."
        )
        return

    src = Path(args.image_path)
    if not src.exists():
        _fail(f"image not found: {src}")

    with Image.open(src) as im:
        im = im.convert("RGB")
        small = im.copy()
        small.thumbnail((256, 256))
        # PIL.quantize gives a small palette which we can sort by importance.
        q = small.quantize(colors=max(8, int(args.count) * 3), method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette() or []
        counts = sorted(q.getcolors() or [], key=lambda x: -x[0])

    def _rgb_to_hex(r: int, g: int, b: int) -> str:
        return "#{:02X}{:02X}{:02X}".format(r, g, b)

    def _saturation(r: int, g: int, b: int) -> float:
        mx, mn = max(r, g, b), min(r, g, b)
        if mx == 0:
            return 0.0
        return (mx - mn) / mx

    candidates: list[tuple[float, str, int]] = []
    total = sum(c for c, _ in counts) or 1
    for count, idx in counts:
        r, g, b = pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2]
        score = _saturation(r, g, b) * 0.6 + (count / total) * 0.4
        candidates.append((score, _rgb_to_hex(r, g, b), count))

    # de-duplicate by hex, keep order of best score
    seen: set[str] = set()
    picked: list[tuple[float, str, int]] = []
    for sc, hx, c in sorted(candidates, key=lambda x: -x[0]):
        if hx in seen:
            continue
        seen.add(hx)
        picked.append((sc, hx, c))
        if len(picked) >= int(args.count):
            break

    if args.json:
        _print_json([{"hex": hx, "score": round(sc, 4), "pixels": c} for sc, hx, c in picked])
    else:
        for sc, hx, c in picked:
            print(f"{hx}  score={sc:.3f}  pixels={c}")


# --------------------------------------------------------------------------- #
# Parser.
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_canvas",
        description="Manipulate Pinsela native (PinselaTemplateDocV1) JSON documents.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_common_write(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--no-backup", action="store_true", help="don't write a .bak alongside the file")
        sp.add_argument("--allow-invalid", action="store_true", help="write even if validation fails")

    # new
    sp = sub.add_parser("new", help="create a fresh minimal doc")
    sp.add_argument("--canvas", default="1080x1080", help="WxH (default 1080x1080)")
    sp.add_argument("--bg", default="#F2ECE4", help="background color (default #F2ECE4)")
    sp.add_argument("--out", required=True, help="output path")
    sp.add_argument("--force", action="store_true", help="overwrite if --out exists")
    sp.add_argument("--no-backup", action="store_true")
    sp.set_defaults(func=cmd_new)

    # validate
    sp = sub.add_parser("validate", help="validate a doc")
    sp.add_argument("path")
    sp.set_defaults(func=cmd_validate)

    # summarize
    sp = sub.add_parser("summarize", help="print structured summary")
    sp.add_argument("path")
    sp.set_defaults(func=cmd_summarize)

    # tree
    sp = sub.add_parser("tree", help="print node tree (ASCII)")
    sp.add_argument("path")
    sp.set_defaults(func=cmd_tree)

    # find
    sp = sub.add_parser("find", help="locate node(s)")
    sp.add_argument("path")
    sp.add_argument("--by-name", help="case-insensitive substring match on node.name")
    sp.add_argument("--by-kind", choices=ops.VALID_KINDS, help="exact match on node.kind")
    sp.add_argument("--by-id", help="exact match on node.id")
    sp.add_argument("--json", action="store_true", help="output matched nodes as JSON")
    sp.set_defaults(func=cmd_find)

    # patch
    sp = sub.add_parser("patch", help="deep-merge values into a node")
    sp.add_argument("path")
    sp.add_argument("node_id")
    sp.add_argument("--set", action="append", help="key=value (key may use dot paths, e.g. geometry.x=120)")
    sp.add_argument("--json", help="JSON object to deep-merge into the node")
    add_common_write(sp)
    sp.set_defaults(func=cmd_patch)

    # add
    sp = sub.add_parser("add", help="add a new node under a parent")
    sp.add_argument("path")
    sp.add_argument("parent_id")
    sp.add_argument("kind", choices=ops.VALID_KINDS)
    sp.add_argument("--name", default=None)
    sp.add_argument("--props", help="JSON object merged onto the default node")
    add_common_write(sp)
    sp.set_defaults(func=cmd_add)

    # remove
    sp = sub.add_parser("remove", help="remove a node and all descendants")
    sp.add_argument("path")
    sp.add_argument("node_id")
    add_common_write(sp)
    sp.set_defaults(func=cmd_remove)

    # reorder
    sp = sub.add_parser("reorder", help="adjust a node's z_index")
    sp.add_argument("path")
    sp.add_argument("node_id")
    g = sp.add_mutually_exclusive_group()
    g.add_argument("--delta", type=int, default=None)
    g.add_argument("--to-front", action="store_true")
    g.add_argument("--to-back", action="store_true")
    sp.add_argument("--no-backup", action="store_true")
    sp.set_defaults(func=cmd_reorder)

    # clone
    sp = sub.add_parser("clone", help="duplicate a node + descendants")
    sp.add_argument("path")
    sp.add_argument("node_id")
    sp.add_argument("--offset", help="dx,dy (default 0,0)")
    add_common_write(sp)
    sp.set_defaults(func=cmd_clone)

    # apply-pattern
    sp = sub.add_parser("apply-pattern", help="splice a pattern under a parent")
    sp.add_argument("path")
    sp.add_argument("pattern", help="pattern name (looked up under $PINSELA_PATTERN_DIR, default <repo>/patterns) or absolute JSON path")
    sp.add_argument("--at", required=True, help="parent node id")
    sp.add_argument("--vars", action="append", help="key=value (substitutes {{key}} in pattern)")
    add_common_write(sp)
    sp.set_defaults(func=cmd_apply_pattern)

    # diff
    sp = sub.add_parser("diff", help="structural diff between two docs")
    sp.add_argument("path_a")
    sp.add_argument("path_b")
    sp.set_defaults(func=cmd_diff)

    # render
    sp = sub.add_parser("render", help="POST the doc to the local Pinsela API and save a PNG")
    sp.add_argument("path")
    sp.add_argument("--out", default=None, help="output PNG path (default: <path>.preview.png)")
    sp.add_argument("--scale", default="1.0")
    sp.add_argument("--bg", choices=["as-is", "transparent", "white"], default="as-is")
    sp.add_argument("--api", default="http://localhost:8000", help="API base URL (default http://localhost:8000)")
    sp.set_defaults(func=cmd_render)

    # extract-palette
    sp = sub.add_parser("extract-palette", help="extract a color palette from a reference image")
    sp.add_argument("image_path")
    sp.add_argument("--count", type=int, default=5)
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_extract_palette)

    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
