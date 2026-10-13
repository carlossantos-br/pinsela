#!/usr/bin/env python3
"""Smoke test for the macro preprocessor.

Builds tiny test docs for each macro type, expands them with
``expand_macros``, validates the expanded doc, optionally renders via the
running API, and reports which artefacts were produced.

Usage:

    python3 test_macros.py [--api http://localhost:8000] [--no-render]

Generates files under /tmp/:

    /tmp/test_macro_shadow.png
    /tmp/test_macro_gradient.png
    /tmp/test_macro_glow.png
    /tmp/test_macro_brush.png
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


_API_ROOT = Path(__file__).resolve().parents[2] / "apps" / "api"
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))


from pinsela.services.doc_macros import added_nodes_count, expand_macros  # noqa: E402
from pinsela.services.template_native import validate_native_doc  # noqa: E402


CANVAS_W = 600
CANVAS_H = 400


def _base_doc(root_id: str = "root") -> dict:
    return {
        "version": 1,
        "canvas": {"width": CANVAS_W, "height": CANVAS_H, "background": "#F2F2F2"},
        "root_id": root_id,
        "nodes": [
            {
                "id": root_id,
                "kind": "frame",
                "name": "root",
                "geometry": {
                    "x": 0,
                    "y": 0,
                    "width": CANVAS_W,
                    "height": CANVAS_H,
                    "z_index": 0,
                },
                "style": {"fill": "#F2F2F2"},
                "children_ids": [],
            }
        ],
    }


def _shadow_doc() -> dict:
    doc = _base_doc()
    doc["nodes"].append(
        {
            "id": "card",
            "parent_id": "root",
            "kind": "rect",
            "name": "card",
            "geometry": {
                "x": 180,
                "y": 110,
                "width": 240,
                "height": 180,
                "corner_radius": 24,
                "z_index": 10,
            },
            "style": {"fill": "#FFFFFF"},
            "_macros": {
                "drop_shadow": {
                    "offset_x": 0,
                    "offset_y": 12,
                    "blur_px": 28,
                    "color": "#000000",
                    "opacity": 0.45,
                }
            },
        }
    )
    doc["nodes"][0]["children_ids"] = ["card"]
    return doc


def _gradient_doc() -> dict:
    doc = _base_doc()
    doc["nodes"].append(
        {
            "id": "gradient_card",
            "parent_id": "root",
            "kind": "rect",
            "name": "gradient_card",
            "geometry": {
                "x": 80,
                "y": 80,
                "width": 440,
                "height": 240,
                "corner_radius": 16,
                "z_index": 10,
            },
            "style": {"fill": "#FFFFFF"},
            "_macros": {
                "gradient": {
                    "type": "linear",
                    "angle": 45,
                    "stops": [
                        {"offset": 0.0, "color": "#FFB800"},
                        {"offset": 0.5, "color": "#FF6A00"},
                        {"offset": 1.0, "color": "#FF3300"},
                    ],
                    "transparent": False,
                }
            },
        }
    )
    doc["nodes"][0]["children_ids"] = ["gradient_card"]
    return doc


def _glow_doc() -> dict:
    doc = _base_doc()
    # Use a dark background so glow is visible.
    doc["canvas"]["background"] = "#10131A"
    doc["nodes"][0]["style"] = {"fill": "#10131A"}
    doc["nodes"].append(
        {
            "id": "pill",
            "parent_id": "root",
            "kind": "rect",
            "name": "pill",
            "geometry": {
                "x": 220,
                "y": 150,
                "width": 160,
                "height": 100,
                "corner_radius": 50,
                "z_index": 10,
            },
            "style": {"fill": "#7CF8C3"},
            "_macros": {
                "glow": {
                    "radius": 36,
                    "color": "#7CF8C3",
                    "intensity": 0.75,
                }
            },
        }
    )
    doc["nodes"][0]["children_ids"] = ["pill"]
    return doc


def _brush_doc() -> dict:
    doc = _base_doc()
    doc["nodes"].append(
        {
            "id": "stroke",
            "parent_id": "root",
            "kind": "rect",
            "name": "stroke",
            "geometry": {
                "x": 80,
                "y": 170,
                "width": 440,
                "height": 60,
                "corner_radius": 8,
                "z_index": 10,
            },
            "style": {"fill": "#222222"},
            "_macros": {
                "brush": {
                    "preset": "chalk",
                    "weight": 24,
                    "color": "#222222",
                    "count": 30,
                }
            },
        }
    )
    doc["nodes"][0]["children_ids"] = ["stroke"]
    return doc


CASES = {
    "shadow": _shadow_doc,
    "gradient": _gradient_doc,
    "glow": _glow_doc,
    "brush": _brush_doc,
}


def _build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    tok = os.environ.get("PINSELA_AGENT_TOKEN", "").strip()
    if tok:
        headers["X-Agent-Token"] = tok
    return headers


def _render_via_api(api: str, doc: dict, out_path: Path) -> tuple[bool, str]:
    try:
        import httpx
    except Exception as exc:
        return False, f"httpx unavailable: {exc}"

    url = api.rstrip("/") + "/api/agent/macros/render"
    body = {
        "doc": doc,
        "payload": {},
        "output_kind": "png",
        "scale": 1.0,
        "background_mode": "as-is",
        "return_format": "binary",
    }
    try:
        res = httpx.post(url, json=body, headers=_build_headers(), timeout=60.0)
    except Exception as exc:
        return False, f"request failed: {exc}"

    if res.status_code >= 400:
        return False, f"http {res.status_code}: {res.text[:200]}"

    out_path.write_bytes(res.content)
    return True, f"ok ({len(res.content)} bytes)"


def _render_local(doc: dict, out_path: Path) -> tuple[bool, str]:
    """Fallback: invoke the renderer directly without going through HTTP."""
    try:
        from pinsela.services.render_engine_native import render_native_template  # type: ignore
    except Exception as exc:
        return False, f"renderer import failed: {exc}"
    try:
        result = render_native_template(doc, {}, db=None, background_mode="as-is")
        png_bytes, _meta = result["png"]
        out_path.write_bytes(png_bytes)
        return True, f"ok ({len(png_bytes)} bytes, local)"
    except Exception as exc:
        return False, f"render failed: {exc}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default=os.environ.get("PINSELA_API_BASE", "http://localhost:8000"))
    p.add_argument("--no-render", action="store_true", help="Only expand + validate.")
    p.add_argument(
        "--local",
        action="store_true",
        help="Skip API and call the renderer directly.",
    )
    args = p.parse_args()

    print("Macro smoke test starting…")
    print(f"  api={args.api}  local={args.local}  no_render={args.no_render}")

    summary: list[dict] = []
    failures = 0

    for name, build in CASES.items():
        doc = build()
        try:
            expanded = expand_macros(doc)
        except Exception as exc:
            summary.append({"case": name, "expand": "fail", "error": str(exc)})
            failures += 1
            continue

        stats = expanded.pop("_macro_stats", {})
        try:
            validated = validate_native_doc(expanded)
        except Exception as exc:
            summary.append(
                {"case": name, "expand": "ok", "validate": "fail", "error": str(exc)}
            )
            failures += 1
            continue

        added = stats
        out_path = Path(f"/tmp/test_macro_{name}.png")

        render_status = "skipped"
        if not args.no_render:
            if args.local:
                ok, msg = _render_local(validated, out_path)
            else:
                ok, msg = _render_via_api(args.api, validated, out_path)
                if not ok:
                    # Fallback to local render if API is unreachable.
                    fb_ok, fb_msg = _render_local(validated, out_path)
                    if fb_ok:
                        ok, msg = True, fb_msg + " (via local fallback)"
                    else:
                        msg = f"{msg}; local fallback: {fb_msg}"
            render_status = msg
            if not ok:
                failures += 1
        size = out_path.stat().st_size if out_path.exists() else 0
        summary.append(
            {
                "case": name,
                "expand": "ok",
                "validate": "ok",
                "stats": added,
                "render": render_status,
                "out": str(out_path),
                "bytes": size,
                "above_1kb": size > 1024,
            }
        )

    print(json.dumps({"failures": failures, "results": summary}, indent=2))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
