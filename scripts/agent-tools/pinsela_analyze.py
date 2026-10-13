#!/usr/bin/env python3
"""pinsela_analyze — CLI for the reference-image design-DNA analyzer.

Usage::

    python3 pinsela_analyze.py <image.png> [--out report.json] [--viz]
    python3 pinsela_analyze.py compare-doc <image.png> <doc.json> [--out delta.json]

Outputs JSON to stdout by default. With ``--out`` the JSON is also written to a
file. With ``--viz`` a visualization image is saved next to the report.

This script defers to the Pinsela API venv when available (where Pillow + numpy
are installed). The bash wrapper ``pinsela_analyze`` (no extension) handles the
interpreter selection.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make the analyzer importable when invoked standalone.
_API_ROOT = Path(__file__).resolve().parents[2] / "apps" / "api"
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from pinsela.services.reference_analyzer import (  # noqa: E402
    analyze_reference,
    compare_layouts,
    render_overlay,
)


def _print_json(obj, *, out: Path | None) -> None:
    text = json.dumps(obj, indent=2, ensure_ascii=False)
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
        print(f"[analyze] wrote {out}", file=sys.stderr)
    print(text)


def _cmd_analyze(args: argparse.Namespace) -> int:
    image_path = Path(args.image).expanduser()
    if not image_path.exists():
        print(f"[analyze] file not found: {image_path}", file=sys.stderr)
        return 2
    report = analyze_reference(image_path)
    if args.viz:
        viz_path = (
            Path(args.viz_out)
            if args.viz_out
            else image_path.with_suffix(".analysis.png")
        )
        render_overlay(image_path, report, viz_path)
        print(f"[analyze] viz written to {viz_path}", file=sys.stderr)
        report.setdefault("_meta", {})["viz_path"] = str(viz_path)
    _print_json(report, out=(Path(args.out) if args.out else None))
    return 0


def _cmd_compare(args: argparse.Namespace) -> int:
    image_path = Path(args.image).expanduser()
    doc_path = Path(args.doc).expanduser()
    if not image_path.exists():
        print(f"[analyze] image not found: {image_path}", file=sys.stderr)
        return 2
    if not doc_path.exists():
        print(f"[analyze] doc not found: {doc_path}", file=sys.stderr)
        return 2
    doc = json.loads(doc_path.read_text(encoding="utf-8"))
    result = compare_layouts(image_path, doc)
    _print_json(result, out=(Path(args.out) if args.out else None))
    return 0


def _build_analyze_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_analyze",
        description="Reference-image design-DNA analyzer for the Pinsela agent loop.",
    )
    p.add_argument("image", help="Path to the reference image.")
    p.add_argument(
        "--out",
        help="Write JSON report to this path (in addition to stdout).",
    )
    p.add_argument(
        "--viz",
        action="store_true",
        help="Render a visualization image with bboxes + palette swatches.",
    )
    p.add_argument(
        "--viz-out",
        dest="viz_out",
        help="Where to write the visualization (default: <image>.analysis.png).",
    )
    return p


def _build_compare_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_analyze compare-doc",
        description="Compare a reference image to an existing pinsela_native_v1 doc.",
    )
    p.add_argument("image", help="Reference image path.")
    p.add_argument("doc", help="Path to the candidate doc JSON.")
    p.add_argument("--out", help="Write delta JSON to this path.")
    return p


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "compare-doc":
        parser = _build_compare_parser()
        args = parser.parse_args(argv[1:])
        return _cmd_compare(args)
    if not argv or argv[0] in {"-h", "--help"}:
        # Print a concise top-level usage that lists both modes.
        print(
            "usage:\n"
            "  pinsela_analyze <image.png> [--out report.json] [--viz [--viz-out path]]\n"
            "  pinsela_analyze compare-doc <image.png> <doc.json> [--out delta.json]\n"
        )
        return 0 if argv else 1
    parser = _build_analyze_parser()
    args = parser.parse_args(argv)
    return _cmd_analyze(args)


if __name__ == "__main__":
    sys.exit(main())
