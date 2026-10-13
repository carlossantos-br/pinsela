#!/usr/bin/env python3
"""pinsela_visual_diff — Compare a rendered candidate against a reference image.

Designed for the "copy this artwork" agent loop: emit structured, actionable
feedback so Claude knows exactly which region/color/brightness to fix next.

Usage:
    pinsela_visual_diff compare REF.png CAND.png [--out DIR] [--grid 4x4|6x6|8x8]
    pinsela_visual_diff palette IMAGE.png [--count 5]
    pinsela_visual_diff describe IMAGE.png

Outputs (compare):
    <out>/report.json          - full structured report
    <out>/diff_overlay.png     - reference with red highlights on top-diff regions
    <out>/side_by_side.png     - reference | candidate | overlay (single image)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Tuple

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

try:
    from PIL import Image  # noqa: F401
except ImportError:
    sys.stderr.write(
        "error: Pillow is required. Run via the API venv:\n"
        "  apps/api/.venv/bin/python "
        "scripts/agent-tools/pinsela_visual_diff.py ...\n"
    )
    sys.exit(2)

import visual_diff_ops as vdo  # noqa: E402


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #

def _fail(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def _parse_grid(s: str) -> Tuple[int, int]:
    s = s.lower().strip()
    if "x" not in s:
        _fail(f"--grid expects WxH (e.g. 6x6), got {s!r}")
    parts = s.split("x", 1)
    try:
        a = int(parts[0])
        b = int(parts[1])
    except ValueError:
        _fail(f"--grid must be integers, got {s!r}")
    if a < 1 or b < 1 or a > 32 or b > 32:
        _fail(f"--grid out of range (1..32), got {s!r}")
    return (a, b)


def _print_table(rows, headers, widths=None):
    if widths is None:
        widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    line = "  ".join(str(h).ljust(widths[i]) for i, h in enumerate(headers))
    print(line)
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print("  ".join(str(r[i]).ljust(widths[i]) for i in range(len(headers))))


# --------------------------------------------------------------------------- #
# compare.
# --------------------------------------------------------------------------- #

def cmd_compare(args: argparse.Namespace) -> None:
    ref_path = Path(args.reference)
    cand_path = Path(args.candidate)
    if not ref_path.exists():
        _fail(f"reference not found: {ref_path}")
    if not cand_path.exists():
        _fail(f"candidate not found: {cand_path}")

    grid = _parse_grid(args.grid)
    report = vdo.compare(str(ref_path), str(cand_path), grid=grid)

    out_dir = Path(args.out) if args.out else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        report_path = vdo.write_report(report, str(out_dir))

        # Save overlay + side-by-side.
        ref_img = vdo._open_rgb(str(ref_path))
        cand_img = vdo._open_rgb(str(cand_path))
        ref_d = vdo._downsample(ref_img)
        cand_d = cand_img.resize(ref_d.size, Image.BILINEAR)  # type: ignore[name-defined]

        overlay_path = str(out_dir / "diff_overlay.png")
        sbs_path = str(out_dir / "side_by_side.png")
        vdo.make_overlay(ref_d, report["regions"], overlay_path, top_n=5)
        vdo.make_side_by_side(ref_d, cand_d, report["regions"], sbs_path, top_n=5)
    else:
        report_path = None
        overlay_path = None
        sbs_path = None

    # Console output.
    s = report["summary"]
    print(f"overall diff:  {s['overall_diff_pct']:.2f}%   verdict: {s['verdict']}")
    sz = report["sizes"]
    print(
        f"sizes:         ref {sz['reference'][0]}x{sz['reference'][1]}  "
        f"cand {sz['candidate'][0]}x{sz['candidate'][1]}  "
        f"compared@{sz['compared_at'][0]}x{sz['compared_at'][1]}  "
        f"aspect_match={sz['aspect_match']}"
    )
    br = report["brightness"]
    print(
        f"brightness:    ref_luma={br['ref_mean_luma']}  cand_luma={br['cand_mean_luma']}  "
        f"delta={br['delta']}  contrast_delta={br['contrast_delta']}"
    )
    print()
    print("top 5 regions (by diff):")
    rows = []
    for r in report["top_regions"]:
        rows.append([
            r["rank"],
            r["grid_cell"],
            f"{r['diff_pct']:.2f}%",
            r["ref_avg_hex"],
            r["cand_avg_hex"],
        ])
    _print_table(rows, ["rank", "cell", "diff", "ref_color", "cand_color"])

    print()
    print("palette comparison (reference -> nearest candidate):")
    prows = []
    for p in report["palette"]["comparison"][:6]:
        prows.append([
            p["ref_hex"],
            f"{p['ref_share']:.2f}",
            p["nearest_cand_hex"] or "(none)",
            f"{p['nearest_cand_share']:.2f}",
            f"{p['distance']:.3f}",
        ])
    _print_table(prows, ["ref_hex", "ref_share", "cand_hex", "cand_share", "dist"])

    print()
    print("interpretation:")
    for h in report["interpretation"]:
        print(f"  - {h}")

    if out_dir:
        print()
        print(f"wrote: {report_path}")
        print(f"wrote: {overlay_path}")
        print(f"wrote: {sbs_path}")

    if args.json:
        print()
        print(json.dumps(report, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------- #
# palette.
# --------------------------------------------------------------------------- #

def cmd_palette(args: argparse.Namespace) -> None:
    src = Path(args.image_path)
    if not src.exists():
        _fail(f"image not found: {src}")
    img = vdo._open_rgb(str(src))
    pal = vdo.dominant_colors(img, count=int(args.count))
    rows = [[i + 1, hx, f"{pct * 100:.1f}%"] for i, (hx, pct) in enumerate(pal)]
    _print_table(rows, ["#", "hex", "share"])
    if args.json:
        print()
        print(json.dumps([{"hex": h, "share": s} for h, s in pal], indent=2))


# --------------------------------------------------------------------------- #
# describe.
# --------------------------------------------------------------------------- #

def cmd_describe(args: argparse.Namespace) -> None:
    src = Path(args.image_path)
    if not src.exists():
        _fail(f"image not found: {src}")
    info = vdo.describe(str(src))
    d = info["dimensions"]
    print(f"path:           {info['path']}")
    print(f"dimensions:     {d['width']}x{d['height']} (aspect {d['aspect']})")
    print(f"suggested type: {info['suggested_type']}")
    print(f"has_alpha:      {info['has_alpha']}")
    print(f"mean_luma:      {info['mean_luma']} (contrast_std {info['contrast_std']})")
    print(f"text_likely:    {info['has_text_likely']} (score {info['text_likeness']})")
    print("dominant colors:")
    rows = [[i + 1, c["hex"], f"{c['share'] * 100:.1f}%"] for i, c in enumerate(info["dominant_colors"])]
    _print_table(rows, ["#", "hex", "share"])
    if args.json:
        print()
        print(json.dumps(info, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------- #
# compare-v2 (structural + patch proposals).
# --------------------------------------------------------------------------- #

def cmd_compare_v2(args: argparse.Namespace) -> None:
    ref_path = Path(args.reference)
    cand_path = Path(args.candidate)
    if not ref_path.exists():
        _fail(f"reference not found: {ref_path}")
    if not cand_path.exists():
        _fail(f"candidate not found: {cand_path}")

    grid = _parse_grid(args.grid)
    report = vdo.compare_v2(str(ref_path), str(cand_path), grid=grid)

    out_dir = Path(args.out) if args.out else None
    written: dict = {}
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        written = vdo.write_report_v2(report, str(out_dir))

        ref_img = vdo._open_rgb(str(ref_path))
        ref_d = vdo._downsample(ref_img)
        overlay_path = str(out_dir / "diff_overlay_classified.png")
        vdo.make_classified_overlay(ref_d, report["cells"], report["clusters"], overlay_path)
        written["overlay"] = overlay_path

    s = report["summary"]
    print(
        f"overall:   {s['overall_diff_pct']:.2f}%   "
        f"weighted: {s['weighted_diff_pct']:.2f}%   "
        f"verdict:  {s['verdict']}"
    )
    print(f"patches:   {s['patch_count']}   kinds: {s['kind_counts']}")
    print()
    print("top patches (priority desc):")
    rows = []
    for p in report["patches"][:10]:
        box = p["region"]["box"]
        rows.append([
            p["rank"],
            p["kind"].upper(),
            p["action"],
            p["region"]["label"],
            f"{box[0]},{box[1]}-{box[2]},{box[3]}",
            f"{p['params'].get('avg_diff_pct', 0):.1f}%",
            p["priority"],
        ])
    _print_table(rows, ["#", "kind", "action", "loc", "box", "avg_diff", "prio"])

    if out_dir and written:
        print()
        print(f"wrote: {written.get('report')}")
        print(f"wrote: {written.get('patches')}")
        print(f"wrote: {written.get('overlay')}")

    if args.json:
        print()
        print(json.dumps(report, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------- #
# argparse.
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_visual_diff",
        description="Compare a rendered candidate image against a reference image.",
    )
    sub = p.add_subparsers(dest="cmd")
    sub.required = True

    sc = sub.add_parser("compare", help="compare reference vs candidate")
    sc.add_argument("reference", help="path to reference image (the target)")
    sc.add_argument("candidate", help="path to candidate image (what was rendered)")
    sc.add_argument("--out", help="output directory for report + overlay + side-by-side")
    sc.add_argument("--grid", default="6x6", help="region grid WxH (default 6x6)")
    sc.add_argument("--json", action="store_true", help="also print full JSON report")
    sc.set_defaults(func=cmd_compare)

    sv = sub.add_parser(
        "compare-v2",
        help="structural compare with classified diff + actionable patches",
    )
    sv.add_argument("reference", help="path to reference image (the target)")
    sv.add_argument("candidate", help="path to candidate image (what was rendered)")
    sv.add_argument("--out", help="output directory for report_v2.json + patches.json + overlay")
    sv.add_argument("--grid", default="12x12", help="region grid WxH (default 12x12)")
    sv.add_argument("--json", action="store_true", help="also print full JSON report")
    sv.set_defaults(func=cmd_compare_v2)

    sp = sub.add_parser("palette", help="extract dominant colors from an image")
    sp.add_argument("image_path")
    sp.add_argument("--count", type=int, default=5)
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_palette)

    sd = sub.add_parser("describe", help="print structured summary of an image")
    sd.add_argument("image_path")
    sd.add_argument("--json", action="store_true")
    sd.set_defaults(func=cmd_describe)

    return p


def main(argv=None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
