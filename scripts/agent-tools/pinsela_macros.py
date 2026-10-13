#!/usr/bin/env python3
"""pinsela_macros — CLI for the macro preprocessor + gradient generator.

Subcommands:

    expand   <doc.json> [--out expanded.json]
        Reads a doc with _macros annotations, expands them, prints stats,
        writes the expanded doc.

    render   <doc.json> [--out preview.png] [--api http://localhost:8000]
                       [--scale 1.0] [--bg as-is|white|transparent]
        Calls POST /api/agent/macros/render and saves the PNG.

    gradient --w W --h H --angle DEG --stops "#FF0000@0,#00FF00@1"
             [--type linear|radial] [--transparent]
             [--out gradient.png] [--api ...]
        Generates a standalone gradient PNG.

Tries the API venv first (httpx, pillow). Falls back to system python3.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #

DEFAULT_APIS = ("http://localhost:8000", "http://localhost:8201")


def _eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def _build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    tok = os.environ.get("PINSELA_AGENT_TOKEN", "").strip()
    if tok:
        headers["X-Agent-Token"] = tok
    return headers


def _load_doc(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        _eprint(f"error: file not found: {path}")
        sys.exit(2)
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception as exc:
        _eprint(f"error: invalid JSON in {path}: {exc}")
        sys.exit(2)


def _parse_stops(raw: str) -> list[list]:
    """Parse "#FF0000@0,#00FF00@1" → [[0,"#FF0000"], [1,"#00FF00"]]."""
    out: list[list] = []
    for chunk in (raw or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "@" not in chunk:
            _eprint(f"error: bad stop '{chunk}', expected '#RRGGBB@offset'")
            sys.exit(2)
        color, _, off = chunk.partition("@")
        try:
            offset = float(off)
        except Exception:
            _eprint(f"error: bad stop offset in '{chunk}'")
            sys.exit(2)
        out.append([offset, color.strip()])
    if not out:
        _eprint("error: --stops required at least one stop")
        sys.exit(2)
    out.sort(key=lambda x: x[0])
    return out


# --------------------------------------------------------------------------- #
# `expand` subcommand — pure local, no API needed.
# --------------------------------------------------------------------------- #


def cmd_expand(args: argparse.Namespace) -> int:
    # Try direct import from the api package; fall back to API for envs
    # without it on sys.path.
    api_root = Path(__file__).resolve().parents[2] / "apps" / "api"
    if str(api_root) not in sys.path:
        sys.path.insert(0, str(api_root))
    try:
        from pinsela.services.doc_macros import expand_macros  # type: ignore
        from pinsela.services.template_native import validate_native_doc  # type: ignore
    except Exception as exc:
        _eprint(f"error: cannot import pinsela package locally: {exc}")
        _eprint(
            "hint: run via the API venv: "
            "apps/api/.venv/bin/python "
            + __file__
        )
        return 2

    doc = _load_doc(args.doc_path)
    try:
        expanded = expand_macros(doc)
    except Exception as exc:
        _eprint(f"error: expand failed: {exc}")
        return 2

    stats = expanded.pop("_macro_stats", {})
    try:
        validated = validate_native_doc(expanded)
    except Exception as exc:
        _eprint(f"error: expanded doc failed validation: {exc}")
        return 2

    out_path = args.out or (str(Path(args.doc_path).with_suffix(".expanded.json")))
    Path(out_path).write_text(json.dumps(validated, indent=2, ensure_ascii=False), "utf-8")

    print(json.dumps({"ok": True, "out": out_path, "stats": stats}, indent=2))
    return 0


# --------------------------------------------------------------------------- #
# `render` subcommand — calls /api/agent/macros/render.
# --------------------------------------------------------------------------- #


def _resolve_api(api: str | None) -> str:
    if api:
        return api
    env = os.environ.get("PINSELA_API_BASE")
    if env:
        return env
    return DEFAULT_APIS[0]


def cmd_render(args: argparse.Namespace) -> int:
    try:
        import httpx
    except Exception:
        _eprint("error: httpx not available; run via API venv")
        return 2

    doc = _load_doc(args.doc_path)
    api = _resolve_api(args.api)
    url = api.rstrip("/") + "/api/agent/macros/render"
    body = {
        "doc": doc,
        "payload": {},
        "output_kind": "png",
        "scale": float(args.scale),
        "background_mode": args.bg,
        "return_format": "binary",
    }
    try:
        res = httpx.post(url, json=body, headers=_build_headers(), timeout=60.0)
    except Exception as exc:
        _eprint(f"error: request failed: {exc}")
        return 2

    if res.status_code >= 400:
        _eprint(f"error: {res.status_code} {res.text[:200]}")
        return 2

    out_path = args.out or (str(Path(args.doc_path).with_suffix(".macros.png")))
    Path(out_path).write_bytes(res.content)
    print(
        json.dumps(
            {
                "ok": True,
                "out": out_path,
                "bytes": len(res.content),
                "width": res.headers.get("X-Render-Width"),
                "height": res.headers.get("X-Render-Height"),
                "added_nodes": res.headers.get("X-Macros-Added-Nodes"),
                "duration_ms": res.headers.get("X-Render-Duration-Ms"),
            },
            indent=2,
        )
    )
    return 0


# --------------------------------------------------------------------------- #
# `gradient` subcommand — calls /api/agent/macros/gradient OR runs locally.
# --------------------------------------------------------------------------- #


def cmd_gradient(args: argparse.Namespace) -> int:
    stops = _parse_stops(args.stops)
    if args.local:
        api_root = Path(__file__).resolve().parents[2] / "apps" / "api"
        if str(api_root) not in sys.path:
            sys.path.insert(0, str(api_root))
        try:
            from pinsela.services.gradient_renderer import (  # type: ignore
                render_gradient_to_file,
            )
        except Exception as exc:
            _eprint(f"error: local mode requires pinsela package: {exc}")
            return 2
        try:
            path, data = render_gradient_to_file(
                width=args.w,
                height=args.h,
                gradient_type=args.type,
                angle=args.angle,
                center=None,
                radius=None,
                stops=stops,
                transparent=args.transparent,
            )
        except Exception as exc:
            _eprint(f"error: render failed: {exc}")
            return 2
        out_path = args.out or str(path)
        if args.out:
            Path(out_path).write_bytes(data)
        print(json.dumps({"ok": True, "out": out_path, "bytes": len(data), "cache_path": str(path)}, indent=2))
        return 0

    try:
        import httpx
    except Exception:
        _eprint("error: httpx not available; run via API venv or pass --local")
        return 2

    api = _resolve_api(args.api)
    url = api.rstrip("/") + "/api/agent/macros/gradient"
    body = {
        "width": int(args.w),
        "height": int(args.h),
        "angle": float(args.angle),
        "stops": stops,
        "type": args.type,
        "transparent": bool(args.transparent),
    }
    try:
        res = httpx.post(url, json=body, headers=_build_headers(), timeout=60.0)
    except Exception as exc:
        _eprint(f"error: request failed: {exc}")
        return 2

    if res.status_code >= 400:
        _eprint(f"error: {res.status_code} {res.text[:200]}")
        return 2

    out_path = args.out or "/tmp/gradient.png"
    Path(out_path).write_bytes(res.content)
    print(
        json.dumps(
            {
                "ok": True,
                "out": out_path,
                "bytes": len(res.content),
                "cache_path": res.headers.get("X-Gradient-Cache-Path"),
                "sha256": res.headers.get("X-Gradient-Sha256"),
            },
            indent=2,
        )
    )
    return 0


# --------------------------------------------------------------------------- #
# Entry point.
# --------------------------------------------------------------------------- #


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Pinsela macro preprocessor CLI.")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_expand = sub.add_parser("expand", help="Expand macros in a doc.json.")
    p_expand.add_argument("doc_path")
    p_expand.add_argument("--out", default=None)
    p_expand.set_defaults(func=cmd_expand)

    p_render = sub.add_parser("render", help="Expand + render via API.")
    p_render.add_argument("doc_path")
    p_render.add_argument("--out", default=None)
    p_render.add_argument("--api", default=None)
    p_render.add_argument("--scale", default=1.0, type=float)
    p_render.add_argument(
        "--bg", default="as-is", choices=["as-is", "transparent", "white"]
    )
    p_render.set_defaults(func=cmd_render)

    p_grad = sub.add_parser("gradient", help="Generate a standalone gradient.")
    p_grad.add_argument("--w", required=True, type=int)
    p_grad.add_argument("--h", required=True, type=int)
    p_grad.add_argument("--angle", default=0.0, type=float)
    p_grad.add_argument("--stops", required=True, help="'#RRGGBB@offset,#RRGGBB@offset'")
    p_grad.add_argument("--type", default="linear", choices=["linear", "radial"])
    p_grad.add_argument("--transparent", action="store_true")
    p_grad.add_argument("--out", default=None)
    p_grad.add_argument("--api", default=None)
    p_grad.add_argument(
        "--local",
        action="store_true",
        help="Run locally without hitting the API (requires pinsela package).",
    )
    p_grad.set_defaults(func=cmd_gradient)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
