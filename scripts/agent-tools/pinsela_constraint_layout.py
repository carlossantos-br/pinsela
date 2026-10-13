#!/usr/bin/env python3
"""pinsela_constraint_layout — declarative layout solver.

Takes a YAML or JSON spec listing elements with high-level constraints
(center_x, below, right_of, gap, ...) and computes pixel x/y/w/h for each.
Catches impossible / circular constraints. Outputs assignments ready to
splice into a doc.json.

Spec schema:
    canvas: { width: int, height: int }
    elements:
      - id: logo
        center_x: canvas_center
        y: 60
        w: 280
        h: 170
      - id: title
        center_x: canvas_center
        below: logo
        gap_above: 24
        w: 960
        min_h: 90
        h: 120

Supported constraints (per element):
    x, y, w, h            -- literal pixel values
    min_h, min_w          -- floor for computed dim
    center_x: <id|canvas_center>   -- align center to other element/canvas
    center_y: <id|canvas_center>
    right_of: <id>        -- left edge aligned to other right edge
    left_of:  <id>        -- right edge aligned to other left edge
    below:    <id>        -- top edge aligned to other bottom edge
    above:    <id>        -- bottom edge aligned to other top edge
    align_left:  <id>     -- same x
    align_right: <id>     -- same (x+w)
    align_top:   <id>     -- same y
    align_bottom:<id>     -- same (y+h)
    gap_above / gap_below / gap_left / gap_right  -- adds to the above

Output:
    JSON dict { id -> {x, y, w, h} }
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
    _HAS_YAML = True
except Exception:
    _HAS_YAML = False


CANVAS_TOKEN = "canvas_center"


def _load_spec(path: str) -> dict:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix.lower() in (".yaml", ".yml"):
        if not _HAS_YAML:
            raise SystemExit("error: PyYAML not installed, use JSON or `pip install pyyaml`")
        return yaml.safe_load(text)
    return json.loads(text)


def _deps(elem: dict) -> set[str]:
    out: set[str] = set()
    for key in (
        "center_x", "center_y", "right_of", "left_of", "below", "above",
        "align_left", "align_right", "align_top", "align_bottom",
    ):
        v = elem.get(key)
        if isinstance(v, str) and v != CANVAS_TOKEN:
            out.add(v)
    return out


def _topo_order(elements: list[dict]) -> list[str]:
    by_id = {e["id"]: e for e in elements}
    deps = {eid: _deps(by_id[eid]) for eid in by_id}
    order: list[str] = []
    visited: set[str] = set()
    visiting: set[str] = set()

    def visit(node: str) -> None:
        if node in visited:
            return
        if node in visiting:
            raise SystemExit(f"error: circular dependency at {node}")
        if node not in by_id:
            raise SystemExit(f"error: dep on unknown element id {node!r}")
        visiting.add(node)
        for d in deps[node]:
            visit(d)
        visiting.discard(node)
        visited.add(node)
        order.append(node)

    for eid in by_id:
        visit(eid)
    return order


def solve(spec: dict) -> dict[str, dict[str, float]]:
    canvas = spec.get("canvas", {})
    cw = float(canvas.get("width", 1080))
    ch = float(canvas.get("height", 1080))
    elements = spec.get("elements", [])
    by_id = {e["id"]: e for e in elements}
    order = _topo_order(elements)
    placed: dict[str, dict[str, float]] = {}

    for eid in order:
        e = by_id[eid]
        # Width / height first.
        w = float(e.get("w", e.get("width", 100)))
        h = float(e.get("h", e.get("height", 50)))
        if "min_w" in e:
            w = max(w, float(e["min_w"]))
        if "min_h" in e:
            h = max(h, float(e["min_h"]))

        # X resolution.
        x = None
        if "x" in e:
            x = float(e["x"])
        if "center_x" in e:
            ref = e["center_x"]
            if ref == CANVAS_TOKEN:
                x = (cw - w) / 2.0
            else:
                r = placed[ref]
                x = r["x"] + (r["w"] - w) / 2.0
        if "right_of" in e:
            ref = placed[e["right_of"]]
            gap = float(e.get("gap_left", 0))
            x = ref["x"] + ref["w"] + gap
        if "left_of" in e:
            ref = placed[e["left_of"]]
            gap = float(e.get("gap_right", 0))
            x = ref["x"] - gap - w
        if "align_left" in e:
            x = placed[e["align_left"]]["x"]
        if "align_right" in e:
            r = placed[e["align_right"]]
            x = r["x"] + r["w"] - w
        if x is None:
            x = 0.0

        # Y resolution.
        y = None
        if "y" in e:
            y = float(e["y"])
        if "center_y" in e:
            ref = e["center_y"]
            if ref == CANVAS_TOKEN:
                y = (ch - h) / 2.0
            else:
                r = placed[ref]
                y = r["y"] + (r["h"] - h) / 2.0
        if "below" in e:
            ref = placed[e["below"]]
            gap = float(e.get("gap_above", 0))
            y = ref["y"] + ref["h"] + gap
        if "above" in e:
            ref = placed[e["above"]]
            gap = float(e.get("gap_below", 0))
            y = ref["y"] - gap - h
        if "align_top" in e:
            y = placed[e["align_top"]]["y"]
        if "align_bottom" in e:
            r = placed[e["align_bottom"]]
            y = r["y"] + r["h"] - h
        if y is None:
            y = 0.0

        # Bounds check.
        warnings = []
        if x < 0 or y < 0:
            warnings.append("negative-origin")
        if x + w > cw:
            warnings.append("overflow-right")
        if y + h > ch:
            warnings.append("overflow-bottom")

        placed[eid] = {"x": x, "y": y, "w": w, "h": h}
        if warnings:
            placed[eid]["_warnings"] = warnings  # type: ignore

    return placed


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="pinsela_constraint_layout",
        description="Solve a declarative layout spec into pixel coords.",
    )
    ap.add_argument("spec", help="Path to YAML/JSON layout spec")
    ap.add_argument("--out", help="Output JSON path (default: stdout)")
    ap.add_argument("--pretty", action="store_true", help="Pretty-print as table")
    args = ap.parse_args()

    spec = _load_spec(args.spec)
    placed = solve(spec)

    if args.pretty:
        print(f"{'id':<24} {'x':>8} {'y':>8} {'w':>8} {'h':>8}  warnings")
        print("-" * 70)
        for eid, p in placed.items():
            warns = ",".join(p.get("_warnings", []) or [])  # type: ignore
            print(f"{eid:<24} {p['x']:>8.1f} {p['y']:>8.1f} {p['w']:>8.1f} {p['h']:>8.1f}  {warns}")
    payload = json.dumps(placed, indent=2)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"layout written: {args.out}", file=sys.stderr)
    elif not args.pretty:
        print(payload)

    # exit code non-zero if any element has overflow warnings
    bad = any("_warnings" in p for p in placed.values())
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
