#!/usr/bin/env python3
"""pinsela_asset_tag — auto-tag the assets directory.

Walks <data root>/assets/ (apps/api/data/assets, or $PINSELA_SERVER_DATA_ROOT; or
a custom --root), inspects each image, and classifies it via heuristics:

    aspect_ratio        : portrait, landscape, square, ultra-wide, etc
    has_text_overlay    : true if edge density > threshold
    has_skin_tone       : true if a meaningful fraction of pixels falls
                          into a Cb/Cr skin range
    has_alpha           : transparency channel present and used
    dominant_class      : one of {logo, decorative, portrait_close,
                                  portrait_body, photo_with_text,
                                  product_mockup, icon, photo_other}

Optionally merges new tags into an asset catalog JSON
(default <data root>/asset-catalog.json, or $PINSELA_ASSET_CATALOG). Existing
manual entries keep their `name`/`usage_hint` but get an `auto_tags` field.

Usage:
    python3 pinsela_asset_tag.py scan [--root DIR] [--limit N] [--out FILE]
    python3 pinsela_asset_tag.py update-catalog [--root DIR] [--catalog PATH]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

_DATA_ROOT = Path(os.environ.get("PINSELA_SERVER_DATA_ROOT") or Path(__file__).resolve().parents[2] / "apps" / "api" / "data")
ASSETS_ROOT_DEFAULT = _DATA_ROOT / "assets"
CATALOG_DEFAULT = Path(os.environ.get("PINSELA_ASSET_CATALOG") or _DATA_ROOT / "asset-catalog.json")

SUPPORTED_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def classify_aspect(w: int, h: int) -> str:
    if h == 0:
        return "unknown"
    r = w / h
    if 0.95 <= r <= 1.05:
        return "square"
    if r < 0.7:
        return "portrait"
    if r > 1.7:
        return "landscape-wide"
    if r > 1.05:
        return "landscape"
    return "portrait-soft"


def _skin_fraction(img) -> float:
    """Cheap YCbCr skin detector. Returns fraction of pixels classified as skin."""
    from PIL import Image
    rgb = img.convert("RGB")
    # downsample for speed
    rgb.thumbnail((128, 128))
    px = rgb.load()
    w, h = rgb.size
    total = w * h
    if total == 0:
        return 0.0
    hits = 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # YCbCr conversion (BT.601)
            y_ = 0.299 * r + 0.587 * g + 0.114 * b
            cb = 128 - 0.169 * r - 0.331 * g + 0.500 * b
            cr = 128 + 0.500 * r - 0.419 * g - 0.081 * b
            if 80 <= cb <= 130 and 135 <= cr <= 180 and y_ > 60:
                hits += 1
    return hits / total


def _edge_density(img) -> float:
    """Cheap edge density via Pillow's FIND_EDGES filter."""
    from PIL import Image, ImageFilter
    gs = img.convert("L")
    gs.thumbnail((256, 256))
    edges = gs.filter(ImageFilter.FIND_EDGES)
    data = edges.getdata()
    total = sum(1 for v in data if v > 64)
    return total / max(1, len(data))


def _alpha_usage(img) -> float:
    """Fraction of pixels with alpha < 250."""
    from PIL import Image
    if img.mode not in ("RGBA", "LA"):
        return 0.0
    img_rgba = img.convert("RGBA")
    img_rgba.thumbnail((256, 256))
    alpha = img_rgba.split()[-1].getdata()
    if not alpha:
        return 0.0
    transparent = sum(1 for v in alpha if v < 250)
    return transparent / len(alpha)


def classify_dominant(aspect: str, skin: float, edges: float, alpha: float, w: int, h: int) -> str:
    if alpha > 0.6 and edges < 0.04 and min(w, h) < 600:
        return "icon"
    if alpha > 0.6 and aspect in ("landscape", "landscape-wide") and min(w, h) < 400:
        return "decorative"
    if alpha > 0.4 and aspect == "landscape-wide":
        return "logo"
    if skin > 0.18 and aspect == "portrait":
        return "portrait_close" if (w < 900) else "portrait_body"
    if skin > 0.12 and aspect in ("square", "portrait-soft"):
        return "portrait_close"
    if edges > 0.18:
        return "photo_with_text"
    if alpha > 0.3:
        return "decorative"
    if skin > 0.05:
        return "portrait_body"
    return "photo_other"


def inspect_image(path: Path) -> dict[str, Any]:
    from PIL import Image
    with Image.open(path) as img:
        img.load()
        w, h = img.size
        aspect = classify_aspect(w, h)
        skin = _skin_fraction(img)
        edges = _edge_density(img)
        alpha = _alpha_usage(img)
        dom = classify_dominant(aspect, skin, edges, alpha, w, h)
    tags: list[str] = [aspect, dom]
    if alpha > 0.3:
        tags.append("transparent")
    if skin > 0.1:
        tags.append("skin")
    if edges > 0.15:
        tags.append("text-heavy")
    return {
        "path": str(path),
        "filename": path.name,
        "width": w,
        "height": h,
        "aspect": aspect,
        "skin_fraction": round(skin, 4),
        "edge_density": round(edges, 4),
        "alpha_usage": round(alpha, 4),
        "dominant_class": dom,
        "auto_tags": sorted(set(tags)),
    }


def scan_dir(root: Path, limit: int | None = None) -> list[dict[str, Any]]:
    files = sorted(p for p in root.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXT)
    if limit:
        files = files[:limit]
    out: list[dict[str, Any]] = []
    for i, f in enumerate(files, 1):
        try:
            out.append(inspect_image(f))
        except Exception as e:
            out.append({"path": str(f), "error": str(e)})
        if i % 10 == 0:
            print(f"  scanned {i}/{len(files)}", file=sys.stderr)
    return out


def cmd_scan(args: argparse.Namespace) -> int:
    root = Path(args.root)
    if not root.exists():
        print(f"error: root does not exist: {root}", file=sys.stderr)
        return 2
    results = scan_dir(root, limit=args.limit)
    payload = json.dumps(results, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"wrote: {args.out} ({len(results)} entries)", file=sys.stderr)
    else:
        print(payload)
    # log
    print(f"summary: {len(results)} assets scanned", file=sys.stderr)
    classes: dict[str, int] = {}
    for r in results:
        c = r.get("dominant_class", "?")
        classes[c] = classes.get(c, 0) + 1
    for k, v in sorted(classes.items()):
        print(f"  {k}: {v}", file=sys.stderr)
    return 0


def cmd_update_catalog(args: argparse.Namespace) -> int:
    root = Path(args.root)
    catalog_path = Path(args.catalog)
    if not catalog_path.exists():
        print(f"error: catalog not found at {catalog_path}", file=sys.stderr)
        return 2

    # backup first (user preference)
    from datetime import datetime, timezone
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup = catalog_path.with_suffix(catalog_path.suffix + f".bak.autotag.{stamp}")
    backup.write_bytes(catalog_path.read_bytes())
    print(f"backup: {backup}", file=sys.stderr)

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    existing = catalog.get("assets", [])
    by_path = {Path(e["path"]).name: e for e in existing if "path" in e}

    results = scan_dir(root, limit=args.limit)
    merged_count = 0
    new_count = 0
    for r in results:
        if "error" in r:
            continue
        fname = Path(r["path"]).name
        if fname in by_path:
            entry = by_path[fname]
            entry["auto_tags"] = r["auto_tags"]
            entry["auto_class"] = r["dominant_class"]
            entry["auto_metrics"] = {
                "skin_fraction": r["skin_fraction"],
                "edge_density": r["edge_density"],
                "alpha_usage": r["alpha_usage"],
                "aspect": r["aspect"],
            }
            merged_count += 1
        elif args.add_new:
            existing.append({
                "id": f"auto-{Path(r['path']).stem[:12]}",
                "name": f"(auto) {r['dominant_class']} {r['aspect']}",
                "path": r["path"],
                "kind": r["dominant_class"],
                "width": r["width"],
                "height": r["height"],
                "auto_tags": r["auto_tags"],
                "auto_class": r["dominant_class"],
                "auto_metrics": {
                    "skin_fraction": r["skin_fraction"],
                    "edge_density": r["edge_density"],
                    "alpha_usage": r["alpha_usage"],
                    "aspect": r["aspect"],
                },
                "tags": ["auto-discovered"],
            })
            new_count += 1

    catalog["assets"] = existing
    from datetime import datetime, timezone
    catalog["auto_tagged_at"] = datetime.now(timezone.utc).isoformat()
    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"catalog updated: merged={merged_count} new={new_count} (total assets={len(existing)})", file=sys.stderr)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="pinsela_asset_tag", description="Auto-tag the Pinsela asset directory.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("scan", help="Scan assets and emit JSON")
    p.add_argument("--root", default=str(ASSETS_ROOT_DEFAULT))
    p.add_argument("--limit", type=int)
    p.add_argument("--out")
    p.set_defaults(fn=cmd_scan)

    p = sub.add_parser("update-catalog", help="Merge auto-tags into brand catalog")
    p.add_argument("--root", default=str(ASSETS_ROOT_DEFAULT))
    p.add_argument("--catalog", default=str(CATALOG_DEFAULT))
    p.add_argument("--limit", type=int)
    p.add_argument("--add-new", action="store_true", help="Append untracked assets as new entries")
    p.set_defaults(fn=cmd_update_catalog)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
