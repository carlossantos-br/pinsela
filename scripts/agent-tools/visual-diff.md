# visual-diff reference

Tools for comparing a rendered candidate image against a reference image and
emitting actionable feedback for the executor/evaluator loop.

Files:
- `visual_diff_ops.py` — pure-Pillow library (no numpy). Contains both v1 and v2.
- `pinsela_visual_diff.py` — CLI with `compare`, `compare-v2`, `palette`, `describe`.
- `evaluator_helper.py` — turns a v2 report into a tight markdown review.
- API router: `apps/api/pinsela/api/routers/agent_diff.py` mounts the endpoints.

Backups: `visual_diff_ops.py.bak`, `pinsela_visual_diff.py.bak`, `agent_diff.py.bak`.

## v1: `compare` (existing — color/brightness/region grid)

```
pinsela_visual_diff compare REF.png CAND.png --out DIR [--grid 6x6] [--json]
```

Outputs:
- `report.json` — overall diff %, grid cells, palette, brightness, interpretation.
- `diff_overlay.png` — red highlights on top regions.
- `side_by_side.png` — REFERENCE | CANDIDATE | OVERLAY.

Endpoint: `POST /api/agent/diff/compare`
Body: `{"ref_path": "...", "cand_path": "...", "grid": [6,6]}`

Use v1 for quick smoke tests. It does NOT distinguish "missing element"
from "wrong color in same element" — that's why v2 exists.

## v2: `compare-v2` (structural diff + patch proposals)

```
pinsela_visual_diff compare-v2 REF.png CAND.png --out DIR [--grid 12x12] [--json]
```

What's new:
- Finer 12x12 grid by default.
- Each cell is classified into one of:
  - `missing` — reference has content, candidate is blank/flat here.
  - `extra`   — candidate has content, reference is blank.
  - `photo`   — large rich-color region differs.
  - `text`    — high edge-density region differs.
  - `geometry`— structural profile shifted (luma_std / edges) but color similar.
  - `color`   — similar structure, different mean color.
  - `unknown` — diff present but did not match.
  - `match`   — cell below `V2_MIN_DIFF` (default 0.03).
- Neighboring same-kind cells are merged into clusters (4-neighbor union-find).
- Each cluster becomes a **patch** with: `priority`, `action`, `region.box`,
  `params.{ref_hex, cand_hex, hint, ...}`, `impact`.
- `weighted_diff` re-weights cells: photo regions ×3, text regions ×2.

Outputs (in `--out DIR`):
- `report_v2.json` — full structured report.
- `patches.json` — sorted patch list (executor reads this directly).
- `diff_overlay_classified.png` — colored by kind:
  - red = missing
  - yellow = extra
  - orange = photo
  - magenta = text
  - green = geometry
  - blue = color

Patch shape:
```json
{
  "rank": 1,
  "priority": 104,
  "action": "add_element",
  "kind": "missing",
  "region": {"box": [152, 360, 456, 720], "label": "center"},
  "params": {
    "region_label": "center",
    "ref_hex": "#A3A09B",
    "cand_hex": "#D2BBA4",
    "avg_diff_pct": 21.4,
    "max_diff_pct": 28.1,
    "cells": 8,
    "confidence": 0.83,
    "subtype": "photo",
    "hint": "photo"
  },
  "impact": 519232.0,
  "notes": ["reference contains photo-like content but candidate is plainer"]
}
```

Endpoints:
- `POST /api/agent/diff/compare-v2` — by path.
- `POST /api/agent/diff/compare-v2-base64` — inline base64 images.
Body: `{"ref_path": "...", "cand_path": "...", "grid": [12,12]}`

## evaluator_helper.py

```
evaluator_helper.py REF.png CAND.png [--out review.md] [--top 6] [--grid 12x12] [--json]
```

Produces a compact markdown review with:
- `VERDICT: approved | needs_revision | replan`
- `DIFF: overall X% / weighted Y%`
- `PATCHES: N total — kind=count, ...`
- A top-N numbered list, each entry includes `[KIND]`, region label, bbox,
  `action=...`, avg_diff%, and a one-line hint.

Example output:
```
VERDICT: needs_revision (raw=needs_revision_missing_element)
DIFF: overall 10.9% / weighted 11.8% (photo+text-weighted)
PATCHES: 31 total — geometry=9, unknown=6, extra=5, text=5, missing=4, color=2

ITERATION FEEDBACK (sorted by impact — fix top-down):
1. [MISSING] center (y=360-720, x=152-456) — action=add_element avg_diff=21.4%
   ref_avg=#A3A09B cand_avg=#D2BBA4 (subtype=photo). Element exists in
   reference but is absent or far too plain in candidate. Add it.
```

The executor agent can pipe this straight into its prompt — every line is
actionable and references a concrete bbox.

## Optimal Convergence Strategy

Order the executor's fixes by impact, not by report order:

1. **MISSING / EXTRA first.** A missing photo dominates every other metric.
   Adding the element shifts the overall_diff dramatically; trying to
   color-correct around a missing region is wasted work.
2. **PHOTO next.** Photo regions are weighted 3× in `weighted_diff`. Swap
   the photo before fixing surrounding decorations.
3. **TEXT next.** Text regions are weighted 2×. Fix copy, font, size, weight,
   kerning before chasing fills.
4. **GEOMETRY next.** Move/resize the element. Patch params include avg color
   so position can be inferred from neighbouring cells.
5. **COLOR last.** Once composition matches, mop up fills with
   `change_color from=cand_hex to=ref_hex`.

After each batch of patches, re-run `compare-v2`. Convergence is reached when
`verdict == excellent_match` and `weighted_diff_pct < 3`.

### Why `weighted_diff` and not `overall_diff`?

`overall_diff` is a flat pixel mean — a missing portrait inside a mostly-white
poster only moves it a few percent. `weighted_diff` triples the contribution
of photo cells and doubles text cells, so the metric tracks user-perceived
quality rather than pixel volume.

## Tuning knobs

Edit constants at top of `visual_diff_ops.py`:
- `V2_GRID` (default 12×12)
- `V2_MIN_DIFF` (default 0.03 — cells below this are skipped)
- `V2_TEXT_EDGE_THRESHOLD` (default 0.10)
- `V2_PHOTO_SAT_THRESHOLD` (default 32) and `V2_PHOTO_STD_THRESHOLD` (default 22)
- `V2_BLANK_STD_THRESHOLD` (default 6 — below this a region is "blank")
- `OVERLAY_COLORS_V2` — recolor the classified overlay.
