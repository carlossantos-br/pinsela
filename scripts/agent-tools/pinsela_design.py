#!/usr/bin/env python3
"""pinsela_design — brief-to-doc generator.

Takes an English-language design brief and produces a structured design
plan (Markdown). Heuristic only -- no LLM call inside. Optional --build flag
materialises a minimal doc.json.

Examples:
    python3 pinsela_design.py "Create Instagram post Morning coffee $29.90"
    python3 pinsela_design.py "Story BlackFriday course 30% off" --out plan.md
    python3 pinsela_design.py "Banner website yoga workshop" --build /tmp/out.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------- #
# Heuristic dictionaries.
# --------------------------------------------------------------------------- #

FORMAT_MAP: list[tuple[tuple[str, ...], tuple[int, int], str]] = [
    (("story", "stories", "reel", "tiktok"), (1080, 1920), "story-1080x1920"),
    (("post", "instagram", "feed", "square"), (1080, 1080), "feed-1080x1080"),
    (("banner", "site", "website", "header", "hero"), (1920, 1080), "banner-1920x1080"),
    (("rectangle", "landscape", "16x9", "16:9"), (1920, 1080), "landscape-16x9"),
    (("vertical", "9x16", "9:16"), (1080, 1920), "vertical-9x16"),
    (("flyer", "poster", "a4"), (1240, 1754), "poster-a4-150dpi"),
]


TOPICS = {
    "coffee": ("Coffee", "Selected beans, artisan roast"),
    "cake": ("Homemade cake", "House recipe, baked fresh daily"),
    "workshop": ("Workshop", "Hands-on half-day session"),
    "course": ("Course", "Live classes and supporting material"),
    "yoga": ("Yoga class", "Classes for all levels"),
    "show": ("Live show", "Music, bar and good company"),
    "fair": ("Fair", "Local vendors and street food"),
    "sale": ("Sale of the week", "Special offer for a limited time"),
}


PRICE_RE = re.compile(
    r"\$\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)|\$\s*([0-9]+(?:[.,][0-9]{2})?)",
    re.IGNORECASE,
)
PERCENT_RE = re.compile(r"(\d{1,2})\s*%\s*(off|discount)?", re.IGNORECASE)
SESSION_RE = re.compile(r"(\d+)\s*(sessions?|x)\b", re.IGNORECASE)
EVENT_KEYWORDS = (
    "black friday",
    "blackfriday",
    "christmas",
    "new year",
    "mother's day",
    "father's day",
    "women's day",
    "carnival",
    "promotion",
    "launch",
    "new arrival",
)


# --------------------------------------------------------------------------- #
# Brief parser.
# --------------------------------------------------------------------------- #

def _norm(s: str) -> str:
    return s.lower().strip()


def parse_brief(brief: str) -> dict[str, Any]:
    raw = brief.strip()
    low = _norm(raw)

    # canvas
    width, height, format_id = 1080, 1080, "feed-1080x1080"
    for keywords, dims, fid in FORMAT_MAP:
        if any(k in low for k in keywords):
            width, height = dims
            format_id = fid
            break

    # topic
    topic_key = None
    topic_label = None
    topic_desc = None
    for key, (label, desc) in TOPICS.items():
        if key in low:
            topic_key = key
            topic_label = label
            topic_desc = desc
            break

    # price
    price = None
    m = PRICE_RE.search(raw)
    if m:
        price = (m.group(1) or m.group(2) or "").strip()
        if price:
            price = f"${price}"

    # discount
    discount = None
    m = PERCENT_RE.search(raw)
    if m:
        discount = f"{m.group(1)}% OFF"

    # sessions
    sessions = None
    m = SESSION_RE.search(raw)
    if m:
        sessions = f"{m.group(1)}x"

    # event
    event = None
    for ev in EVENT_KEYWORDS:
        if ev in low:
            event = ev
            break

    # intent
    if "post" in low or "feed" in low:
        intent = "feed-post"
    elif "story" in low or "reel" in low:
        intent = "story-vertical"
    elif "banner" in low or "site" in low:
        intent = "site-banner"
    elif "before" in low and "after" in low:
        intent = "before-after"
    elif "agenda" in low:
        intent = "weekly-agenda"
    else:
        intent = "generic-promo"

    return {
        "raw_brief": raw,
        "canvas": {"width": width, "height": height, "format_id": format_id},
        "topic": {"key": topic_key, "label": topic_label, "description": topic_desc},
        "price": price,
        "discount": discount,
        "sessions": sessions,
        "event": event,
        "intent": intent,
    }


# --------------------------------------------------------------------------- #
# Layout/pattern recommendation.
# --------------------------------------------------------------------------- #

def recommend_layout(parsed: dict[str, Any]) -> dict[str, Any]:
    intent = parsed["intent"]
    has_price = bool(parsed["price"])
    has_discount = bool(parsed["discount"])
    canvas = parsed["canvas"]

    if intent == "before-after":
        pattern = "before-after-story"
    elif intent == "weekly-agenda":
        pattern = "weekly-agenda-story"
    elif intent == "story-vertical":
        pattern = "story-announcement-master"
    elif intent == "feed-post" and has_discount:
        pattern = "feed-promo"
    elif intent == "site-banner":
        pattern = "blog-hero"
    else:
        pattern = "feed-promo"

    blocks = ["LOGO_TOP", "DECOR_BORDER_TOP"]
    if parsed["event"]:
        blocks.append("EVENT_BADGE")
    blocks.append("HEADLINE_MAIN")
    if parsed["topic"]["label"]:
        blocks.append("TOPIC_SUBLINE")
    if has_price:
        blocks.append("PRICE_TAG")
    if has_discount:
        blocks.append("DISCOUNT_BADGE")
    if parsed["sessions"]:
        blocks.append("SESSIONS_HINT")
    blocks.append("CTA_PILL")
    blocks.append("DECOR_BORDER_BOTTOM")

    palette = ["#936947", "#D8C0A8", "#F5EBE0", "#3F2A1F", "#FFFFFF"]
    typography = {
        "display": "Inter-Bold @ 96-128px",
        "body": "Inter-Regular @ 32-44px",
        "price": "Inter-Bold @ 72px",
        "subline": "Inter-Medium @ 36px",
    }

    # element positions (rough — agent should refine)
    cw, ch = canvas["width"], canvas["height"]
    positions = []
    cursor_y = 60
    if "LOGO_TOP" in blocks:
        positions.append({"id": "LOGO_TOP", "x": (cw - 280) // 2, "y": cursor_y, "w": 280, "h": 170})
        cursor_y += 200
    if "HEADLINE_MAIN" in blocks:
        positions.append({"id": "HEADLINE_MAIN", "x": 60, "y": cursor_y, "w": cw - 120, "h": 180})
        cursor_y += 200
    if "TOPIC_SUBLINE" in blocks:
        positions.append({"id": "TOPIC_SUBLINE", "x": 60, "y": cursor_y, "w": cw - 120, "h": 80})
        cursor_y += 100
    if "PRICE_TAG" in blocks:
        positions.append({"id": "PRICE_TAG", "x": (cw - 460) // 2, "y": cursor_y, "w": 460, "h": 110})
        cursor_y += 140
    if "CTA_PILL" in blocks:
        positions.append({"id": "CTA_PILL", "x": (cw - 520) // 2, "y": ch - 220, "w": 520, "h": 96})

    return {
        "pattern": pattern,
        "blocks": blocks,
        "palette": palette,
        "typography": typography,
        "positions": positions,
    }


# --------------------------------------------------------------------------- #
# Plan rendering.
# --------------------------------------------------------------------------- #

def render_plan_md(parsed: dict, layout: dict) -> str:
    c = parsed["canvas"]
    lines: list[str] = []
    lines.append(f"# Pinsela Design Plan")
    lines.append("")
    lines.append(f"> Generated: {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"> Brief: `{parsed['raw_brief']}`")
    lines.append("")
    lines.append("## Inferred Canvas & Intent")
    lines.append("")
    lines.append(f"- Canvas: **{c['width']} x {c['height']}** ({c['format_id']})")
    lines.append(f"- Intent: `{parsed['intent']}`")
    if parsed["topic"]["label"]:
        lines.append(f"- Topic: **{parsed['topic']['label']}** -- {parsed['topic']['description']}")
    if parsed["price"]:
        lines.append(f"- Price: **{parsed['price']}**")
    if parsed["discount"]:
        lines.append(f"- Discount: **{parsed['discount']}**")
    if parsed["sessions"]:
        lines.append(f"- Sessions: **{parsed['sessions']}**")
    if parsed["event"]:
        lines.append(f"- Event tag: **{parsed['event']}**")
    lines.append("")
    lines.append("## Layout Recommendation")
    lines.append("")
    lines.append(f"- Base pattern: `{layout['pattern']}`")
    lines.append(f"- Apply with: `pinsela_canvas apply-pattern <out.json> {layout['pattern']} --at root`")
    lines.append("")
    lines.append("### Element Blocks (top -> bottom)")
    lines.append("")
    for b in layout["blocks"]:
        lines.append(f"- [ ] `{b}`")
    lines.append("")
    lines.append("## Suggested Palette")
    lines.append("")
    for hx in layout["palette"]:
        lines.append(f"- `{hx}`")
    lines.append("")
    lines.append("## Typography")
    lines.append("")
    for k, v in layout["typography"].items():
        lines.append(f"- **{k}**: {v}")
    lines.append("")
    lines.append("## Estimated Element Positions")
    lines.append("")
    lines.append("| Block | x | y | w | h |")
    lines.append("|---|---|---|---|---|")
    for p in layout["positions"]:
        lines.append(f"| {p['id']} | {p['x']} | {p['y']} | {p['w']} | {p.get('h', '-')} |")
    lines.append("")
    lines.append("## Next Steps")
    lines.append("")
    lines.append("1. Run `pinsela_canvas new --canvas {w}x{h} --bg \"#F5EBE0\" --out doc.json`".format(w=c["width"], h=c["height"]))
    lines.append(f"2. Run `pinsela_canvas apply-pattern doc.json {layout['pattern']} --at root`")
    lines.append("3. Patch text values, swap assets, render preview.")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Optional build.
# --------------------------------------------------------------------------- #

def build_minimal_doc(parsed: dict, layout: dict) -> dict:
    c = parsed["canvas"]
    palette = layout["palette"]
    nodes = []
    headline = parsed["topic"]["label"] or "TITLE"
    subline = parsed["topic"]["description"] or ""

    for p in layout["positions"]:
        nid = p["id"]
        kind = "text"
        text = ""
        if nid == "LOGO_TOP":
            kind = "rect"
        elif nid == "HEADLINE_MAIN":
            text = headline.upper()
        elif nid == "TOPIC_SUBLINE":
            text = subline
        elif nid == "PRICE_TAG":
            text = parsed["price"] or ""
        elif nid == "CTA_PILL":
            text = "BOOK NOW"
        else:
            kind = "rect"

        node: dict[str, Any] = {
            "id": nid,
            "name": nid,
            "kind": kind,
            "geometry": {
                "x": float(p["x"]),
                "y": float(p["y"]),
                "width": float(p["w"]),
                "height": float(p.get("h", 80)),
                "rotation": 0.0,
                "corner_radius": 24.0 if nid == "CTA_PILL" else 0.0,
                "clip": False,
                "z_index": 5,
                "transform_matrix": None,
            },
            "style": {
                "visible": True,
                "locked": False,
                "opacity": 1.0,
                "blend_mode": "normal",
                "fill": palette[0] if kind == "rect" else None,
                "shape_type": None,
                "shape_sides": None,
                "star_points": None,
                "star_inner_ratio": None,
                "stroke": None,
                "shadow": None,
                "image_fit": "cover",
                "image_anchor_x": 0.5,
                "image_anchor_y": 0.5,
            },
            "children": [],
        }
        if kind == "text":
            node["text"] = text
            node["text_style"] = {
                "family": "Inter",
                "postscript": "Inter-Bold",
                "style": "Bold",
                "size": 96 if nid == "HEADLINE_MAIN" else 44,
                "color": palette[3],
                "text_align": "center",
            }
        nodes.append(node)

    doc = {
        "version": 1,
        "kind": "pinsela_native_v1",
        "canvas": {
            "width": float(c["width"]),
            "height": float(c["height"]),
            "background": palette[2],
        },
        "fonts": [],
        "assets": [],
        "root": {
            "id": "root",
            "name": "root",
            "kind": "frame",
            "geometry": {
                "x": 0.0,
                "y": 0.0,
                "width": float(c["width"]),
                "height": float(c["height"]),
                "rotation": 0.0,
                "corner_radius": 0.0,
                "clip": True,
                "z_index": 0,
                "transform_matrix": None,
            },
            "style": {
                "visible": True,
                "locked": False,
                "opacity": 1.0,
                "blend_mode": "normal",
                "fill": palette[2],
            },
            "children": nodes,
        },
    }
    return doc


# --------------------------------------------------------------------------- #
# CLI.
# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(
        prog="pinsela_design",
        description="Brief-to-doc generator. Parses an English design brief and emits a plan.",
    )
    ap.add_argument("brief", nargs="+", help="Portuguese design brief (one or more words)")
    ap.add_argument("--out", default="design_plan.md", help="Plan output path (default: design_plan.md)")
    ap.add_argument("--build", help="If set, also emit minimal doc JSON to this path")
    ap.add_argument("--json", action="store_true", help="Print structured parse as JSON to stdout")
    args = ap.parse_args()

    brief = " ".join(args.brief)
    parsed = parse_brief(brief)
    layout = recommend_layout(parsed)

    if args.json:
        print(json.dumps({"parsed": parsed, "layout": layout}, indent=2, ensure_ascii=False))
        return 0

    md = render_plan_md(parsed, layout)
    Path(args.out).write_text(md, encoding="utf-8")
    print(f"plan written: {args.out}")
    print(f"  canvas={parsed['canvas']['width']}x{parsed['canvas']['height']} pattern={layout['pattern']}")

    if args.build:
        doc = build_minimal_doc(parsed, layout)
        Path(args.build).write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"doc  written: {args.build}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
