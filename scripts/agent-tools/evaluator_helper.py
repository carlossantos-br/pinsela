#!/usr/bin/env python3
"""evaluator_helper — Turn a v2 visual diff into a TIGHT, prioritized markdown
review the executor agent can read directly.

Usage:
    evaluator_helper.py REFERENCE.png CANDIDATE.png [--out review.md] [--top N]
                        [--grid WxH] [--json]

Programmatic:
    from evaluator_helper import evaluate
    review_md = evaluate(ref_path, cand_path, top=5)

Design:
- Calls visual_diff_ops.compare_v2 (structural diff + patches).
- Sorts patches by (kind_priority, impact) — MISSING first, then GEOMETRY, then
  COLOR — and renders a compact, executor-ready markdown checklist.
- Includes verdict + weighted_diff so the loop can decide convergence.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import visual_diff_ops as vdo  # noqa: E402


# Verdict -> human header.
_VERDICT_HEADER = {
    "excellent_match": "approved",
    "minor_tweaks_needed": "needs_revision",
    "needs_revision": "needs_revision",
    "needs_revision_missing_element": "needs_revision",
    "composition_issue_replan": "replan",
}


# Per-kind hint templates. The executor reads these lines verbatim.
_KIND_HINT: Dict[str, str] = {
    "missing":  "Element exists in reference but is absent or far too plain in candidate. Add it.",
    "extra":    "Candidate has content the reference does not. Remove or soften it.",
    "photo":    "Photo region differs. Swap photo, check subject, framing, and crop.",
    "text":     "Text region differs. Verify copy, font family, weight, size, color, kerning.",
    "geometry": "Element appears moved or resized. Verify x, y, width, height match reference.",
    "color":    "Same structure, wrong fill color. Update color to reference value.",
    "unknown":  "Diff detected but did not match a known pattern. Inspect manually.",
}


# --------------------------------------------------------------------------- #
# Public API.
# --------------------------------------------------------------------------- #

def evaluate(
    ref_path: str,
    cand_path: str,
    top: int = 6,
    grid: Tuple[int, int] = vdo.V2_GRID,
) -> Dict[str, Any]:
    """Run compare-v2 and return both the structured report and a markdown review."""
    report = vdo.compare_v2(ref_path, cand_path, grid=grid)
    md = render_review(report, top=top)
    return {"report": report, "review_md": md}


def render_review(report: Dict[str, Any], top: int = 6) -> str:
    s = report["summary"]
    verdict_raw = s["verdict"]
    verdict = _VERDICT_HEADER.get(verdict_raw, verdict_raw)
    weighted = s["weighted_diff_pct"]
    overall = s["overall_diff_pct"]
    kinds = s["kind_counts"]
    patches = report["patches"]

    lines: List[str] = []
    lines.append(f"VERDICT: {verdict} (raw={verdict_raw})")
    lines.append(
        f"DIFF: overall {overall:.1f}% / weighted {weighted:.1f}% (photo+text-weighted)"
    )
    lines.append(
        f"PATCHES: {s['patch_count']} total — "
        + ", ".join(f"{k}={v}" for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]))
    )
    sz = report.get("sizes", {})
    if sz:
        ref = sz.get("reference") or [0, 0]
        cand = sz.get("candidate") or [0, 0]
        lines.append(
            f"SIZES: ref {ref[0]}x{ref[1]} | cand {cand[0]}x{cand[1]} | "
            f"compared@{sz.get('compared_at', [0, 0])}"
        )
    lines.append("")
    lines.append("ITERATION FEEDBACK (sorted by impact — fix top-down):")

    if not patches:
        lines.append("  (no actionable patches — looks converged)")
        return "\n".join(lines) + "\n"

    for i, p in enumerate(patches[:top], start=1):
        kind = p["kind"].upper()
        action = p["action"]
        box = p["region"]["box"]
        loc = p["region"]["label"]
        params = p["params"]
        avg_diff = params.get("avg_diff_pct", 0.0)
        ref_hex = params.get("ref_hex", "?")
        cand_hex = params.get("cand_hex", "?")
        hint = _KIND_HINT.get(p["kind"], "")
        bbox_s = f"y={box[1]}-{box[3]}, x={box[0]}-{box[2]}"
        head = f"{i}. [{kind}] {loc} ({bbox_s}) — action={action} avg_diff={avg_diff:.1f}%"
        lines.append(head)
        # Per-kind detail.
        if p["kind"] == "color":
            lines.append(
                f"   change_color from={cand_hex} to={ref_hex}. {hint}"
            )
        elif p["kind"] in ("missing", "extra"):
            sub = params.get("subtype")
            sub_s = f" (subtype={sub})" if sub else ""
            lines.append(
                f"   ref_avg={ref_hex} cand_avg={cand_hex}{sub_s}. {hint}"
            )
        elif p["kind"] == "photo":
            lines.append(
                f"   ref_avg={ref_hex} cand_avg={cand_hex}. {hint}"
            )
        elif p["kind"] == "text":
            lines.append(
                f"   ref_avg={ref_hex} cand_avg={cand_hex}. {hint}"
            )
        elif p["kind"] == "geometry":
            lines.append(
                f"   ref_avg={ref_hex} cand_avg={cand_hex}. {hint}"
            )
        else:
            lines.append(f"   {hint}")
        if p["notes"]:
            for n in p["notes"][:1]:
                lines.append(f"   note: {n}")

    # Tail: convergence strategy reminder.
    lines.append("")
    lines.append(
        "CONVERGENCE STRATEGY: fix MISSING/EXTRA first (composition), then "
        "PHOTO/TEXT, then GEOMETRY, then COLOR. Re-run compare-v2 after each batch."
    )
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# CLI.
# --------------------------------------------------------------------------- #

def _parse_grid(s: str) -> Tuple[int, int]:
    s = s.lower().strip()
    if "x" not in s:
        print(f"error: --grid expects WxH, got {s!r}", file=sys.stderr)
        sys.exit(2)
    a, b = s.split("x", 1)
    return (int(a), int(b))


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        prog="evaluator_helper",
        description="Run compare-v2 and emit executor-ready markdown review.",
    )
    parser.add_argument("reference", help="reference image path")
    parser.add_argument("candidate", help="candidate image path")
    parser.add_argument("--out", help="path to write the markdown review (default stdout)")
    parser.add_argument("--top", type=int, default=6, help="how many patches to include (default 6)")
    parser.add_argument("--grid", default="12x12", help="region grid WxH (default 12x12)")
    parser.add_argument("--json", action="store_true", help="also dump structured report JSON to stdout after the markdown")
    args = parser.parse_args(argv)

    ref = Path(args.reference)
    cand = Path(args.candidate)
    if not ref.exists():
        print(f"error: reference not found: {ref}", file=sys.stderr)
        sys.exit(2)
    if not cand.exists():
        print(f"error: candidate not found: {cand}", file=sys.stderr)
        sys.exit(2)

    grid = _parse_grid(args.grid)
    out = evaluate(str(ref), str(cand), top=int(args.top), grid=grid)
    md = out["review_md"]

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"wrote: {args.out}")
    else:
        sys.stdout.write(md)

    if args.json:
        print()
        print(json.dumps(out["report"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
