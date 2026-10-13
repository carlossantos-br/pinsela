#!/usr/bin/env python3
"""pinsela_remove_bg — CLI for background removal, agent-friendly.

Usage::

    pinsela_remove_bg.py INPUT [--out OUTPUT] [--model NAME] [--auto]
                              [--alpha-matting] [--trim]
                              [--api URL] [--token TOKEN]
                              [--no-sidecar] [--list-models]

Behaviour:

1.  By default, calls the local Pinsela API at ``http://localhost:8000``.
    The image is sent as base64 to ``/api/agent/bg/remove`` and the result is
    written locally (the server's ``/remove-file`` only accepts paths inside
    its own data root).

2.  If the API is unreachable (connection refused, 404, 5xx) the script falls
    back to running ``rembg`` directly with the current Python interpreter
    (needs ``rembg`` installed). This means the CLI is useful even when the API is down.

3.  Writes ``<output>.json`` sidecar (unless ``--no-sidecar``) with metadata
    suitable for downstream tooling (e.g. picking an ``image`` node geometry
    after a ``--trim``).

The function ``remove_bg_local`` is exposed for ``import`` use::

    from pinsela_remove_bg import remove_bg_local
    result = remove_bg_local('/path/to/in.jpg', out='/path/to/out.png',
                             model='birefnet-portrait', trim=True)
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_API = os.environ.get("PINSELA_API_BASE", "http://localhost:8000")


# --------------------------------------------------------------------------- #
# Core API.
# --------------------------------------------------------------------------- #

def remove_bg_local(
    input_path: str | os.PathLike,
    *,
    out: str | os.PathLike | None = None,
    model: str | None = None,
    auto: bool = False,
    alpha_matting: bool = False,
    trim: bool = False,
    write_sidecar: bool = True,
    api: str | None = None,
    token: str | None = None,
    prefer: str = "auto",  # "auto" | "api" | "subprocess"
) -> dict[str, Any]:
    """High-level entry point usable from other Python tools.

    Returns a dict with at least ``output_path``, ``model_used``, ``backend``,
    ``width``, ``height``, ``bbox``.
    """
    in_path = Path(input_path).expanduser().resolve()
    if not in_path.exists() or not in_path.is_file():
        raise FileNotFoundError(in_path)

    out_path = Path(out).expanduser().resolve() if out else _default_out(in_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    api_base = (api or DEFAULT_API).rstrip("/")

    if prefer in ("auto", "api"):
        try:
            result = _via_api(
                api_base,
                token=token,
                in_path=in_path,
                out_path=out_path,
                model=model,
                auto=auto,
                alpha_matting=alpha_matting,
                trim=trim,
                write_sidecar=write_sidecar,
            )
            result["transport"] = "api"
            return result
        except _ApiUnavailable as exc:
            if prefer == "api":
                raise
            sys.stderr.write(f"[pinsela_remove_bg] API unavailable ({exc}); falling back to subprocess.\n")

    result = _via_subprocess(
        in_path=in_path,
        out_path=out_path,
        model=model,
        auto=auto,
        alpha_matting=alpha_matting,
        trim=trim,
        write_sidecar=write_sidecar,
    )
    result["transport"] = "subprocess"
    return result


# --------------------------------------------------------------------------- #
# API transport.
# --------------------------------------------------------------------------- #

class _ApiUnavailable(RuntimeError):
    pass


def _via_api(
    api_base: str,
    *,
    token: str | None,
    in_path: Path,
    out_path: Path,
    model: str | None,
    auto: bool,
    alpha_matting: bool,
    trim: bool,
    write_sidecar: bool,
) -> dict[str, Any]:
    # /remove-file only accepts paths inside the server data root (anti
    # arbitrary read/write), so we send the bytes as base64 to
    # /remove and we write the result locally.
    url = f"{api_base}/api/agent/bg/remove"
    payload = {
        "image_base64": base64.b64encode(in_path.read_bytes()).decode("ascii"),
        "model": model,
        "auto": auto,
        "alpha_matting": alpha_matting,
        "trim": trim,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if token:
        req.add_header("X-Agent-Token", token)
    elif os.environ.get("PINSELA_AGENT_TOKEN"):
        req.add_header("X-Agent-Token", os.environ["PINSELA_AGENT_TOKEN"])

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = resp.read()
    except urllib.error.URLError as exc:
        raise _ApiUnavailable(repr(exc)) from exc
    except ConnectionError as exc:  # noqa: PERF203
        raise _ApiUnavailable(repr(exc)) from exc

    try:
        result = json.loads(data.decode("utf-8"))
        png = base64.b64decode(result.pop("output_base64"))
    except Exception as exc:
        raise _ApiUnavailable(f"invalid_json_from_api:{exc}") from exc

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(png)
    result["output_path"] = str(out_path)
    result["input_path"] = str(in_path)
    result["original_bytes"] = in_path.stat().st_size
    result["sidecar_path"] = None
    if write_sidecar:
        sidecar = out_path.with_suffix(out_path.suffix + ".json")
        sidecar.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        result["sidecar_path"] = str(sidecar)
    return result


# --------------------------------------------------------------------------- #
# Subprocess fallback.
# --------------------------------------------------------------------------- #

def _pick_python() -> Path:
    """Interpreter used for the local fallback: the one running this script."""
    try:
        subprocess.run(
            [sys.executable, "-c", "import rembg"],
            check=True,
            capture_output=True,
            timeout=60,
        )
    except Exception as exc:
        raise RuntimeError(
            "rembg is not installed in this Python (pip install rembg onnxruntime)."
        ) from exc
    return Path(sys.executable)


def _via_subprocess(
    *,
    in_path: Path,
    out_path: Path,
    model: str | None,
    auto: bool,
    alpha_matting: bool,
    trim: bool,
    write_sidecar: bool,
) -> dict[str, Any]:
    python = _pick_python()
    # Inline driver script — does the work end-to-end (auto model, removal,
    # optional trim, sidecar) without depending on rembg's CLI.
    driver = """
import io, json, sys
from pathlib import Path
from PIL import Image, ImageOps
from rembg import remove, new_session

args = json.loads(sys.argv[1])
inp = Path(args['input']); outp = Path(args['output'])
data = inp.read_bytes()

def auto_model(b):
    try:
        with Image.open(io.BytesIO(b)) as img:
            img = ImageOps.exif_transpose(img).convert('RGB').resize((64,64))
            pixels = list(img.getdata())
    except Exception:
        return 'u2net'
    skin = sum(1 for r,g,bl in pixels if 95<=r<=245 and r>g>=bl and (r-bl)>=15 and (r-g)<=80)
    ref = pixels[0]
    uniform = sum(1 for r,g,bl in pixels if abs(r-ref[0])+abs(g-ref[1])+abs(bl-ref[2])<=40)
    n = max(1, len(pixels))
    if skin/n >= 0.06: return 'birefnet-portrait'
    if uniform/n >= 0.45: return 'isnet-general-use'
    return 'u2net'

model = args.get('model') or 'u2net'
if args.get('auto'):
    model = auto_model(data)

kwargs = {'session': new_session(model), 'post_process_mask': True}
if args.get('alpha_matting'):
    kwargs.update(alpha_matting=True, alpha_matting_foreground_threshold=240,
                  alpha_matting_background_threshold=10, alpha_matting_erode_size=6)

png = remove(data, **kwargs)
bbox = None
with Image.open(io.BytesIO(png)) as img:
    img.load()
    rgba = img.convert('RGBA')
    bbox = rgba.getchannel('A').getbbox()
    width, height = rgba.size

if args.get('trim') and bbox is not None:
    with Image.open(io.BytesIO(png)) as img:
        img.load()
        rgba = img.convert('RGBA').crop(bbox)
        buf = io.BytesIO()
        rgba.save(buf, format='PNG', optimize=True, compress_level=6)
        png = buf.getvalue()
        width, height = rgba.size

outp.parent.mkdir(parents=True, exist_ok=True)
outp.write_bytes(png)

meta = {
    'ok': True,
    'output_path': str(outp),
    'model_used': model,
    'backend': 'subprocess_inline',
    'alpha_matting': bool(args.get('alpha_matting')),
    'trim': bool(args.get('trim')),
    'bbox': list(bbox) if bbox else None,
    'width': width,
    'height': height,
    'bytes': len(png),
    'original_bytes': len(data),
}

if args.get('write_sidecar'):
    sidecar = outp.with_suffix(outp.suffix + '.json')
    sidecar.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    meta['sidecar_path'] = str(sidecar)
else:
    meta['sidecar_path'] = None

sys.stdout.write(json.dumps(meta))
"""
    args_payload = json.dumps({
        "input": str(in_path),
        "output": str(out_path),
        "model": model,
        "auto": auto,
        "alpha_matting": alpha_matting,
        "trim": trim,
        "write_sidecar": write_sidecar,
    })
    proc = subprocess.run(
        [str(python), "-c", driver, args_payload],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"rembg subprocess failed (rc={proc.returncode}): {proc.stderr.strip()}"
        )
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception as exc:
        raise RuntimeError(f"could not parse subprocess output: {exc}\n{proc.stdout}") from exc


# --------------------------------------------------------------------------- #
# CLI.
# --------------------------------------------------------------------------- #

def _default_out(in_path: Path) -> Path:
    return in_path.with_suffix(in_path.suffix + ".nobg.png")


def _list_known_models() -> list[tuple[str, str]]:
    return [
        ("u2net", "General purpose, balanced quality/speed. Good default."),
        ("u2netp", "Lightweight u2net (smaller, faster, lower quality)."),
        ("u2net_human_seg", "Tuned for whole humans (full body)."),
        ("u2net_cloth_seg", "Tuned for clothing segmentation."),
        ("silueta", "u2net-quality at smaller file size."),
        ("isnet-general-use", "High-quality general object segmentation. Best for products."),
        ("isnet-anime", "Anime/illustration character segmentation."),
        ("birefnet-general", "BiRefNet generalist, very high quality (heavy)."),
        ("birefnet-general-lite", "BiRefNet lightweight variant."),
        ("birefnet-portrait", "BiRefNet tuned for portraits. Best for faces."),
        ("birefnet-dis", "BiRefNet dichotomous segmentation."),
        ("birefnet-hrsod", "BiRefNet high-resolution salient object."),
        ("birefnet-cod", "BiRefNet camouflaged object detection."),
        ("birefnet-massive", "BiRefNet largest model (very heavy)."),
        ("sam", "Segment Anything (heavy, needs prompt points)."),
    ]


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_remove_bg",
        description="Remove background from an image (PNG output with transparency).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input", nargs="?", help="Path to input image (PNG/JPG/etc).")
    p.add_argument("--out", "-o", default=None, help="Output PNG path.")
    p.add_argument(
        "--model", "-m", default=None,
        help="rembg model. Default 'u2net'. See --list-models.",
    )
    p.add_argument(
        "--auto", action="store_true",
        help="Auto-select model from image content (portrait/product/general).",
    )
    p.add_argument(
        "--alpha-matting", action="store_true",
        help="Enable alpha matting for cleaner edges (slower).",
    )
    p.add_argument(
        "--trim", action="store_true",
        help="Crop output to the non-transparent bounding box.",
    )
    p.add_argument(
        "--api", default=DEFAULT_API,
        help=f"Pinsela API base URL (default {DEFAULT_API}).",
    )
    p.add_argument(
        "--token", default=None,
        help="X-Agent-Token (overrides PINSELA_AGENT_TOKEN env var).",
    )
    p.add_argument(
        "--prefer", choices=["auto", "api", "subprocess"], default="auto",
        help="Transport preference. 'auto' tries API then subprocess.",
    )
    p.add_argument(
        "--no-sidecar", action="store_true",
        help="Do not write the .json metadata sidecar.",
    )
    p.add_argument(
        "--list-models", action="store_true",
        help="Print available rembg models and exit.",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Print machine-readable JSON only.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.list_models:
        for name, desc in _list_known_models():
            print(f"  {name:<28} {desc}")
        return 0

    if not args.input:
        print("error: missing input image (use --list-models to see models)", file=sys.stderr)
        return 2

    try:
        result = remove_bg_local(
            args.input,
            out=args.out,
            model=args.model,
            auto=args.auto,
            alpha_matting=args.alpha_matting,
            trim=args.trim,
            write_sidecar=not args.no_sidecar,
            api=args.api,
            token=args.token,
            prefer=args.prefer,
        )
    except FileNotFoundError as exc:
        print(f"error: input not found: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f"wrote {result['output_path']}")
    print(f"  model:   {result.get('model_used')}")
    print(f"  backend: {result.get('backend')} (transport={result.get('transport')})")
    print(f"  size:    {result.get('width')}x{result.get('height')} ({result.get('bytes')} bytes)")
    if result.get("bbox"):
        print(f"  bbox:    {result['bbox']}")
    if result.get("sidecar_path"):
        print(f"  sidecar: {result['sidecar_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
