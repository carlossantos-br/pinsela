#!/usr/bin/env python3
"""pinsela_palette — palette utilities for Pinsela designs.

Subcommands:
    extract <image.png> [--count N]
        Cluster pixels and return N dominant hex colors.

    harmonize <hex>
        Given a primary color, suggest a split-complementary 5-color palette.
        Output: { primary, accent_a, accent_b, light, dark }.

    apply <doc.json> --palette <palette.json> [--out PATH]
        Globally swap fills in a doc by role. The palette file must have at
        minimum { primary, accent, light, dark }. Mapping rules:
            - root frame fill           -> light
            - rect fills containing CTA -> primary
            - text colors that are dark -> dark
            - text colors that are light-> primary
            - stroke colors             -> dark
        Saves a `.bak` next to the doc unless --no-backup.

    role-map <doc.json>
        Print a summary of every fill/stroke/text color in a doc and the role
        each would be mapped to.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import sys
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------- #
# Color helpers.
# --------------------------------------------------------------------------- #

def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return "#{:02X}{:02X}{:02X}".format(max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b))))


def is_hex(s: Any) -> bool:
    if not isinstance(s, str):
        return False
    s = s.strip()
    if not s.startswith("#"):
        return False
    body = s[1:]
    return len(body) in (3, 6) and all(c in "0123456789abcdefABCDEF" for c in body)


def relative_luminance(r: int, g: int, b: int) -> float:
    def chan(c: int) -> float:
        cs = c / 255.0
        return cs / 12.92 if cs <= 0.03928 else ((cs + 0.055) / 1.055) ** 2.4
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


# --------------------------------------------------------------------------- #
# Extract.
# --------------------------------------------------------------------------- #

def cmd_extract(args: argparse.Namespace) -> int:
    from PIL import Image
    img = Image.open(args.image).convert("RGB")
    img.thumbnail((256, 256))
    # Pillow's quantize gives a k-clusterish palette quickly.
    q = img.quantize(colors=args.count, method=Image.Quantize.MEDIANCUT)
    palette = q.getpalette() or []
    palette_hex = []
    for i in range(args.count):
        r, g, b = palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]
        palette_hex.append(rgb_to_hex(r, g, b))
    out = {"image": args.image, "palette": palette_hex}
    print(json.dumps(out, indent=2))
    return 0


# --------------------------------------------------------------------------- #
# Harmonize.
# --------------------------------------------------------------------------- #

def cmd_harmonize(args: argparse.Namespace) -> int:
    primary_rgb = hex_to_rgb(args.color)
    r, g, b = (c / 255.0 for c in primary_rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)

    def shift(dh: float, dl: float = 0.0, ds: float = 0.0) -> str:
        nh = (h + dh) % 1.0
        nl = max(0.0, min(1.0, l + dl))
        ns = max(0.0, min(1.0, s + ds))
        nr, ng, nb = colorsys.hls_to_rgb(nh, nl, ns)
        return rgb_to_hex(nr * 255, ng * 255, nb * 255)

    # Split-complementary: primary, +150deg, -150deg ; plus light/dark variants
    palette = {
        "primary": args.color.upper() if args.color.startswith("#") else "#" + args.color.upper(),
        "accent_a": shift(150 / 360),
        "accent_b": shift(-150 / 360),
        "light": shift(0, dl=+0.35, ds=-0.4),
        "dark": shift(0, dl=-0.35, ds=-0.1),
    }
    print(json.dumps(palette, indent=2))
    return 0


# --------------------------------------------------------------------------- #
# Apply / role-map.
# --------------------------------------------------------------------------- #

def _classify_role(hex_color: str, ctx: dict[str, Any]) -> str:
    """Return the palette role for a color/context."""
    if not is_hex(hex_color):
        return "unknown"
    r, g, b = hex_to_rgb(hex_color)
    lum = relative_luminance(r, g, b)
    field = ctx.get("field")
    node_name = (ctx.get("node_name") or "").lower()
    node_kind = ctx.get("node_kind")

    if "cta" in node_name or "pill" in node_name:
        return "primary"
    if node_kind == "frame" and field == "fill":
        return "light"
    if field == "stroke":
        return "dark"
    if field == "text_color":
        return "dark" if lum < 0.45 else "primary"
    if node_kind == "rect":
        if lum < 0.25:
            return "dark"
        if lum > 0.85:
            return "light"
        return "accent_a"
    return "primary"


def _walk_node(node: dict[str, Any], visit) -> None:
    visit(node)
    for child in node.get("children", []) or []:
        _walk_node(child, visit)


def _collect_colors(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    def visit(node: dict[str, Any]) -> None:
        style = node.get("style") or {}
        fill = style.get("fill")
        if is_hex(fill):
            out.append({"node_id": node.get("id"), "node_name": node.get("name"), "node_kind": node.get("kind"), "field": "fill", "color": fill})
        stroke = style.get("stroke")
        if isinstance(stroke, dict):
            scol = stroke.get("color")
            if is_hex(scol):
                out.append({"node_id": node.get("id"), "node_name": node.get("name"), "node_kind": node.get("kind"), "field": "stroke", "color": scol})
        ts = node.get("text_style")
        if isinstance(ts, dict) and is_hex(ts.get("color")):
            out.append({"node_id": node.get("id"), "node_name": node.get("name"), "node_kind": node.get("kind"), "field": "text_color", "color": ts["color"]})
    root = doc.get("root") or doc
    _walk_node(root, visit)
    return out


def cmd_role_map(args: argparse.Namespace) -> int:
    doc = json.loads(Path(args.doc).read_text(encoding="utf-8"))
    rows = _collect_colors(doc)
    print(f"{'NODE':<28} {'FIELD':<14} {'COLOR':<10} ROLE")
    print("-" * 80)
    for r in rows:
        role = _classify_role(r["color"], r)
        print(f"{(r['node_name'] or r['node_id'] or '?'):<28} {r['field']:<14} {r['color']:<10} {role}")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    doc_path = Path(args.doc)
    doc = json.loads(doc_path.read_text(encoding="utf-8"))
    palette = json.loads(Path(args.palette).read_text(encoding="utf-8"))

    def role_color(role: str) -> str | None:
        if role in palette:
            return palette[role]
        # fallback: primary
        return palette.get("primary")

    def visit(node: dict[str, Any]) -> None:
        style = node.get("style") or {}
        ctx_base = {"node_id": node.get("id"), "node_name": node.get("name"), "node_kind": node.get("kind")}
        fill = style.get("fill")
        if is_hex(fill):
            role = _classify_role(fill, {**ctx_base, "field": "fill"})
            new = role_color(role)
            if new:
                style["fill"] = new
        stroke = style.get("stroke")
        if isinstance(stroke, dict) and is_hex(stroke.get("color")):
            role = _classify_role(stroke["color"], {**ctx_base, "field": "stroke"})
            new = role_color(role)
            if new:
                stroke["color"] = new
        ts = node.get("text_style")
        if isinstance(ts, dict) and is_hex(ts.get("color")):
            role = _classify_role(ts["color"], {**ctx_base, "field": "text_color"})
            new = role_color(role)
            if new:
                ts["color"] = new

    root = doc.get("root") or doc
    _walk_node(root, visit)

    out_path = Path(args.out) if args.out else doc_path
    if out_path == doc_path and not args.no_backup:
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        bak = doc_path.with_suffix(doc_path.suffix + f".bak.palette.{stamp}")
        bak.write_text(doc_path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"backup: {bak}", file=sys.stderr)

    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"applied palette to: {out_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="pinsela_palette", description="Palette utilities for Pinsela designs.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("extract", help="Extract a palette from an image")
    p.add_argument("image")
    p.add_argument("--count", type=int, default=5)
    p.set_defaults(fn=cmd_extract)

    p = sub.add_parser("harmonize", help="Suggest a 5-color palette from a primary color")
    p.add_argument("color", help="hex color, e.g. #936947")
    p.set_defaults(fn=cmd_harmonize)

    p = sub.add_parser("apply", help="Apply a palette to all fills in a doc")
    p.add_argument("doc")
    p.add_argument("--palette", required=True)
    p.add_argument("--out")
    p.add_argument("--no-backup", action="store_true")
    p.set_defaults(fn=cmd_apply)

    p = sub.add_parser("role-map", help="Print every color in a doc and the role it maps to")
    p.add_argument("doc")
    p.set_defaults(fn=cmd_role_map)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
