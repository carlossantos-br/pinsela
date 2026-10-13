"""visual_diff_ops — Library functions for visual diffing two images.

Pure Pillow + stdlib. No numpy. Designed for the "copy this artwork" agent loop:
compare reference vs candidate and emit structured, ACTIONABLE feedback.

Design constraints:
- Resize candidate to reference dimensions before comparison.
- Pixel diff returns 0.0 (identical) to 1.0 (maximally different).
- Region diff returns ranked list of grid cells (worst first).
- Dominant colors uses Pillow's quantize (median-cut) for stability.
- Brightness uses ITU-R BT.601 luma.
- All public functions are pure and side-effect-free except `make_*`.
"""

from __future__ import annotations

import io
import json
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


# --------------------------------------------------------------------------- #
# Constants.
# --------------------------------------------------------------------------- #

MAX_DIM = 1080  # downsample large images to keep <1s perf
DEFAULT_GRID: Tuple[int, int] = (6, 6)
OVERLAY_COLOR = (255, 0, 0)  # red highlight for diff regions
LABEL_BG = (0, 0, 0)
LABEL_FG = (255, 255, 255)


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #

def _open_rgb(path: str) -> Image.Image:
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        # Composite onto white so alpha doesn't fake diffs.
        bg = Image.new("RGB", im.size, (255, 255, 255))
        if im.mode == "P":
            im = im.convert("RGBA")
        if im.mode in ("RGBA", "LA"):
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
    else:
        im = im.convert("RGB")
    return im


def _downsample(im: Image.Image, max_dim: int = MAX_DIM) -> Image.Image:
    w, h = im.size
    m = max(w, h)
    if m <= max_dim:
        return im
    scale = max_dim / float(m)
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return im.resize(new_size, Image.BILINEAR)


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return "#{:02X}{:02X}{:02X}".format(int(r), int(g), int(b))


def _hex_to_rgb(hx: str) -> Tuple[int, int, int]:
    hx = hx.lstrip("#")
    return (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16))


def _rgb_distance(a: Tuple[int, int, int], b: Tuple[int, int, int]) -> float:
    """Simple Euclidean distance in RGB, normalized 0..1."""
    dr = a[0] - b[0]
    dg = a[1] - b[1]
    db = a[2] - b[2]
    return math.sqrt(dr * dr + dg * dg + db * db) / math.sqrt(3 * 255 * 255)


def _luma(r: int, g: int, b: int) -> float:
    """ITU-R BT.601 luma (0..255)."""
    return 0.299 * r + 0.587 * g + 0.114 * b


def _try_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


# --------------------------------------------------------------------------- #
# Pixel diff.
# --------------------------------------------------------------------------- #

def pixel_diff(a: Image.Image, b: Image.Image) -> float:
    """Mean absolute pixel difference normalized to 0.0..1.0."""
    if a.size != b.size:
        b = b.resize(a.size, Image.BILINEAR)
    if a.mode != "RGB":
        a = a.convert("RGB")
    if b.mode != "RGB":
        b = b.convert("RGB")
    da = a.tobytes()
    db = b.tobytes()
    n = len(da)
    if n == 0:
        return 0.0
    # Sum absolute diffs across all channels.
    total = 0
    for i in range(n):
        d = da[i] - db[i]
        if d < 0:
            d = -d
        total += d
    return total / (n * 255.0)


# --------------------------------------------------------------------------- #
# Region diff.
# --------------------------------------------------------------------------- #

def region_diff(
    a: Image.Image,
    b: Image.Image,
    grid: Tuple[int, int] = DEFAULT_GRID,
) -> List[Dict[str, Any]]:
    """Divide both into a grid; return per-cell diff sorted descending."""
    if a.size != b.size:
        b = b.resize(a.size, Image.BILINEAR)
    if a.mode != "RGB":
        a = a.convert("RGB")
    if b.mode != "RGB":
        b = b.convert("RGB")

    w, h = a.size
    cols, rows = grid
    cw = w / cols
    ch = h / rows

    cells: List[Dict[str, Any]] = []
    for ry in range(rows):
        for cx in range(cols):
            x0 = int(round(cx * cw))
            y0 = int(round(ry * ch))
            x1 = int(round((cx + 1) * cw))
            y1 = int(round((ry + 1) * ch))
            x1 = min(x1, w)
            y1 = min(y1, h)
            box = (x0, y0, x1, y1)
            ca = a.crop(box)
            cb = b.crop(box)
            d = pixel_diff(ca, cb)
            ra, ga, ba = _avg_color(ca)
            rb, gb, bb = _avg_color(cb)
            cells.append({
                "row": ry,
                "col": cx,
                "grid_cell": f"r{ry}c{cx}",
                "box": [x0, y0, x1, y1],
                "diff": d,
                "diff_pct": round(d * 100.0, 2),
                "ref_avg_hex": _rgb_to_hex(ra, ga, ba),
                "cand_avg_hex": _rgb_to_hex(rb, gb, bb),
                "color_distance": round(_rgb_distance((ra, ga, ba), (rb, gb, bb)), 4),
            })

    cells.sort(key=lambda c: -c["diff"])
    for i, c in enumerate(cells):
        c["rank"] = i + 1
    return cells


def _avg_color(im: Image.Image) -> Tuple[int, int, int]:
    if im.mode != "RGB":
        im = im.convert("RGB")
    # Pillow's resize to 1x1 with BILINEAR is a fast average.
    one = im.resize((1, 1), Image.BILINEAR)
    return one.getpixel((0, 0))  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# Dominant colors.
# --------------------------------------------------------------------------- #

def dominant_colors(img: Image.Image, count: int = 5) -> List[Tuple[str, float]]:
    """Return [(hex, fraction), ...] of dominant colors, length up to `count`."""
    if img.mode != "RGB":
        img = img.convert("RGB")
    small = img.copy()
    small.thumbnail((256, 256))
    q = small.quantize(colors=max(8, count * 3), method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = sorted(q.getcolors() or [], key=lambda x: -x[0])
    total = sum(c for c, _ in counts) or 1

    out: List[Tuple[str, float]] = []
    seen: set[str] = set()
    for c, idx in counts:
        r = pal[idx * 3]
        g = pal[idx * 3 + 1]
        b = pal[idx * 3 + 2]
        hx = _rgb_to_hex(r, g, b)
        if hx in seen:
            continue
        seen.add(hx)
        out.append((hx, round(c / total, 4)))
        if len(out) >= count:
            break
    return out


def palette_distance(
    pal_a: List[Tuple[str, float]],
    pal_b: List[Tuple[str, float]],
) -> List[Dict[str, Any]]:
    """For each reference swatch, find nearest candidate swatch + distance."""
    out: List[Dict[str, Any]] = []
    cand_rgb = [(_hex_to_rgb(h), h, p) for h, p in pal_b]
    for hx, pct in pal_a:
        ra = _hex_to_rgb(hx)
        best = None
        best_d = 999.0
        for rgb, chx, cpct in cand_rgb:
            d = _rgb_distance(ra, rgb)
            if d < best_d:
                best_d = d
                best = (chx, cpct, d)
        if best is None:
            out.append({
                "ref_hex": hx,
                "ref_share": pct,
                "nearest_cand_hex": None,
                "nearest_cand_share": 0.0,
                "distance": 1.0,
                "share_delta": pct,
            })
        else:
            chx, cpct, d = best
            out.append({
                "ref_hex": hx,
                "ref_share": pct,
                "nearest_cand_hex": chx,
                "nearest_cand_share": cpct,
                "distance": round(d, 4),
                "share_delta": round(pct - cpct, 4),
            })
    return out


# --------------------------------------------------------------------------- #
# Brightness / contrast.
# --------------------------------------------------------------------------- #

def _brightness_stats(im: Image.Image) -> Tuple[float, float]:
    """Return (mean_luma, stddev_luma) on 0..255 scale."""
    if im.mode != "RGB":
        im = im.convert("RGB")
    gray = im.convert("L")
    hist = gray.histogram()
    total = sum(hist) or 1
    mean = sum(i * c for i, c in enumerate(hist)) / total
    var = sum(((i - mean) ** 2) * c for i, c in enumerate(hist)) / total
    return mean, math.sqrt(var)


def brightness_delta(a: Image.Image, b: Image.Image) -> float:
    """Signed mean-luma delta on 0..255 scale (b minus a)."""
    ma, _ = _brightness_stats(a)
    mb, _ = _brightness_stats(b)
    return mb - ma


def contrast_delta(a: Image.Image, b: Image.Image) -> float:
    """Signed stddev-luma delta on 0..255 scale (b minus a)."""
    _, sa = _brightness_stats(a)
    _, sb = _brightness_stats(b)
    return sb - sa


# --------------------------------------------------------------------------- #
# Text-likelihood heuristic.
# --------------------------------------------------------------------------- #

def _text_likeness(im: Image.Image) -> float:
    """Cheap proxy: ratio of mid-range luma pixels with sharp local contrast.

    Real text has lots of small high-contrast edges. Returns 0..1.
    """
    if im.mode != "RGB":
        im = im.convert("RGB")
    small = im.copy()
    small.thumbnail((256, 256))
    gray = small.convert("L")
    px = gray.load()
    w, h = gray.size
    edge_hits = 0
    total = 0
    for y in range(0, h - 1, 2):
        for x in range(0, w - 1, 2):
            p = px[x, y]
            q = px[x + 1, y]
            r = px[x, y + 1]
            d = max(abs(p - q), abs(p - r))
            if d > 60:
                edge_hits += 1
            total += 1
    return edge_hits / max(total, 1)


# --------------------------------------------------------------------------- #
# Overlay + side-by-side.
# --------------------------------------------------------------------------- #

def make_overlay(
    ref: Image.Image,
    regions: List[Dict[str, Any]],
    out_path: str,
    top_n: int = 5,
    min_diff: float = 0.02,
) -> str:
    """Draw red rectangles over the top-N most-different regions on the ref."""
    base = ref.copy().convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    shown = 0
    font = _try_font(max(14, base.size[0] // 60))
    for cell in regions:
        if shown >= top_n:
            break
        if cell["diff"] < min_diff:
            continue
        x0, y0, x1, y1 = cell["box"]
        # Translucent fill, opaque border.
        alpha = min(180, int(120 + cell["diff"] * 400))
        draw.rectangle([x0, y0, x1, y1], fill=(255, 0, 0, max(40, alpha // 3)))
        # Thick border
        for k in range(3):
            draw.rectangle([x0 + k, y0 + k, x1 - k, y1 - k], outline=(255, 0, 0, 255))
        label = f"#{cell['rank']} {cell['diff_pct']:.1f}%"
        tx, ty = x0 + 6, y0 + 6
        # Backplate
        try:
            bbox = draw.textbbox((tx, ty), label, font=font)
        except Exception:
            bbox = (tx, ty, tx + 80, ty + 16)
        draw.rectangle(bbox, fill=(0, 0, 0, 200))
        draw.text((tx, ty), label, fill=(255, 255, 255, 255), font=font)
        shown += 1

    composed = Image.alpha_composite(base, overlay).convert("RGB")
    composed.save(out_path, "PNG")
    return out_path


def make_side_by_side(
    ref: Image.Image,
    cand: Image.Image,
    diff_regions: List[Dict[str, Any]],
    out_path: str,
    top_n: int = 5,
) -> str:
    """Compose ref | cand | overlay into a single PNG with labels."""
    # Normalize size: candidate resized to reference size already by caller; defensive.
    if ref.size != cand.size:
        cand = cand.resize(ref.size, Image.BILINEAR)

    target_h = min(ref.size[1], 720)
    scale = target_h / ref.size[1]
    panel_w = max(1, int(round(ref.size[0] * scale)))
    panel_h = target_h

    ref_p = ref.resize((panel_w, panel_h), Image.BILINEAR).convert("RGB")
    cand_p = cand.resize((panel_w, panel_h), Image.BILINEAR).convert("RGB")

    # Build overlay panel from the (already-sized) panel_w x panel_h ref + scaled boxes.
    overlay_panel = ref_p.copy().convert("RGBA")
    ov = Image.new("RGBA", overlay_panel.size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(ov)
    font_small = _try_font(max(12, panel_w // 50))
    shown = 0
    for cell in diff_regions:
        if shown >= top_n:
            break
        if cell["diff"] < 0.02:
            continue
        x0, y0, x1, y1 = cell["box"]
        x0 = int(round(x0 * scale))
        y0 = int(round(y0 * scale))
        x1 = int(round(x1 * scale))
        y1 = int(round(y1 * scale))
        dd.rectangle([x0, y0, x1, y1], fill=(255, 0, 0, 70))
        for k in range(2):
            dd.rectangle([x0 + k, y0 + k, x1 - k, y1 - k], outline=(255, 0, 0, 255))
        label = f"#{cell['rank']}"
        try:
            bbox = dd.textbbox((x0 + 4, y0 + 2), label, font=font_small)
        except Exception:
            bbox = (x0 + 4, y0 + 2, x0 + 40, y0 + 18)
        dd.rectangle(bbox, fill=(0, 0, 0, 200))
        dd.text((x0 + 4, y0 + 2), label, fill=(255, 255, 255, 255), font=font_small)
        shown += 1
    overlay_p = Image.alpha_composite(overlay_panel, ov).convert("RGB")

    # Compose: gap + labels.
    gap = 12
    label_h = 36
    total_w = panel_w * 3 + gap * 4
    total_h = panel_h + label_h + gap * 2
    canvas = Image.new("RGB", (total_w, total_h), (245, 245, 247))
    draw = ImageDraw.Draw(canvas)
    font = _try_font(max(14, panel_w // 32))

    def _place(panel: Image.Image, idx: int, label: str) -> None:
        x = gap + idx * (panel_w + gap)
        y = gap
        canvas.paste(panel, (x, y))
        # Label below.
        try:
            tb = draw.textbbox((x, y + panel_h + 4), label, font=font)
            tw = tb[2] - tb[0]
        except Exception:
            tw = len(label) * 8
        cx = x + (panel_w - tw) // 2
        draw.text((cx, y + panel_h + 6), label, fill=(20, 20, 24), font=font)

    _place(ref_p, 0, "REFERENCE")
    _place(cand_p, 1, "CANDIDATE")
    _place(overlay_p, 2, "DIFF OVERLAY")

    canvas.save(out_path, "PNG")
    return out_path


# --------------------------------------------------------------------------- #
# Top-level compare.
# --------------------------------------------------------------------------- #

def compare(
    ref_path: str,
    cand_path: str,
    grid: Tuple[int, int] = DEFAULT_GRID,
) -> Dict[str, Any]:
    """Run a full comparison and return a structured report dict."""
    ref = _open_rgb(ref_path)
    cand = _open_rgb(cand_path)

    orig_ref_size = ref.size
    orig_cand_size = cand.size

    # Downsample very large images for performance.
    ref_d = _downsample(ref)
    # Match candidate to (possibly downsampled) reference size.
    cand_d = cand.resize(ref_d.size, Image.BILINEAR)

    overall = pixel_diff(ref_d, cand_d)
    regions = region_diff(ref_d, cand_d, grid)
    pal_ref = dominant_colors(ref_d, count=6)
    pal_cand = dominant_colors(cand_d, count=6)
    pal_cmp = palette_distance(pal_ref, pal_cand)

    b_delta = brightness_delta(ref_d, cand_d)
    c_delta = contrast_delta(ref_d, cand_d)
    mean_ref, std_ref = _brightness_stats(ref_d)
    mean_cand, std_cand = _brightness_stats(cand_d)

    ar_ref = orig_ref_size[0] / max(1, orig_ref_size[1])
    ar_cand = orig_cand_size[0] / max(1, orig_cand_size[1])

    verdict = _verdict(overall)
    interpretation = _interpret(overall, regions, pal_cmp, b_delta, c_delta)

    return {
        "summary": {
            "overall_diff": round(overall, 4),
            "overall_diff_pct": round(overall * 100.0, 2),
            "verdict": verdict,
            "grid": list(grid),
        },
        "interpretation": interpretation,
        "sizes": {
            "reference": list(orig_ref_size),
            "candidate": list(orig_cand_size),
            "compared_at": list(ref_d.size),
            "aspect_ref": round(ar_ref, 4),
            "aspect_cand": round(ar_cand, 4),
            "aspect_match": abs(ar_ref - ar_cand) < 0.02,
            "size_match": orig_ref_size == orig_cand_size,
        },
        "brightness": {
            "ref_mean_luma": round(mean_ref, 2),
            "cand_mean_luma": round(mean_cand, 2),
            "delta": round(b_delta, 2),
            "ref_contrast_std": round(std_ref, 2),
            "cand_contrast_std": round(std_cand, 2),
            "contrast_delta": round(c_delta, 2),
        },
        "palette": {
            "reference": [{"hex": h, "share": s} for h, s in pal_ref],
            "candidate": [{"hex": h, "share": s} for h, s in pal_cand],
            "comparison": pal_cmp,
        },
        "regions": regions,
        "top_regions": regions[:5],
    }


def _verdict(overall: float) -> str:
    pct = overall * 100.0
    if pct < 5:
        return "excellent_match"
    if pct < 15:
        return "minor_tweaks_needed"
    if pct < 30:
        return "significant_differences"
    return "composition_issue_replan"


def _interpret(
    overall: float,
    regions: List[Dict[str, Any]],
    pal_cmp: List[Dict[str, Any]],
    b_delta: float,
    c_delta: float,
) -> List[str]:
    """Return human-readable, actionable bullet hints."""
    hints: List[str] = []

    top = regions[0] if regions else None
    if top is None or top["diff"] < 0.02:
        hints.append("Images are nearly identical; no actionable region.")
        return hints

    # Region location hint.
    if top is not None:
        cols = max(c["col"] for c in regions) + 1
        rows = max(c["row"] for c in regions) + 1
        cx, cy = top["col"], top["row"]
        loc = _region_location(cx, cy, cols, rows)
        hints.append(
            f"Largest diff is in the {loc} region "
            f"({top['grid_cell']}, {top['diff_pct']:.1f}%). "
            f"Reference avg {top['ref_avg_hex']} vs candidate {top['cand_avg_hex']}."
        )

    # Uniform vs concentrated diff.
    if len(regions) >= 4:
        diffs = [r["diff"] for r in regions]
        mean_d = sum(diffs) / len(diffs)
        # If top is not much worse than mean -> uniform.
        if top is not None and top["diff"] < mean_d * 1.6:
            hints.append(
                "Diff is spread roughly uniform across the canvas — likely a global "
                "color, font, or background mismatch rather than a localized element."
            )
        else:
            hints.append(
                "Diff is concentrated — fix the top region first, then re-run compare."
            )

    # Palette hints.
    worst_color = max(pal_cmp, key=lambda x: x["distance"]) if pal_cmp else None
    if worst_color and worst_color["distance"] > 0.15:
        hints.append(
            f"Palette mismatch: reference uses {worst_color['ref_hex']} "
            f"(share {worst_color['ref_share']:.2f}) but nearest candidate is "
            f"{worst_color['nearest_cand_hex']} (distance {worst_color['distance']:.2f})."
        )

    # Brightness hints.
    if abs(b_delta) > 12:
        direction = "darker" if b_delta < 0 else "brighter"
        hints.append(
            f"Candidate is overall {direction} by {abs(b_delta):.1f} luma units; "
            "adjust background or text color."
        )

    if abs(c_delta) > 10:
        direction = "flatter" if c_delta < 0 else "punchier"
        hints.append(
            f"Candidate has {direction} contrast (delta {c_delta:.1f}); "
            "review heavy elements like headlines or photos."
        )

    return hints


def _region_location(cx: int, cy: int, cols: int, rows: int) -> str:
    """Map a grid cell to a human label (top-left, center, bottom-right, etc.)."""
    third_c = cols / 3.0
    third_r = rows / 3.0
    if cx < third_c:
        h = "left"
    elif cx < 2 * third_c:
        h = "center"
    else:
        h = "right"
    if cy < third_r:
        v = "top"
    elif cy < 2 * third_r:
        v = "middle"
    else:
        v = "bottom"
    if v == "middle" and h == "center":
        return "center"
    return f"{v}-{h}"


# --------------------------------------------------------------------------- #
# Describe (single-image summary).
# --------------------------------------------------------------------------- #

def describe(image_path: str) -> Dict[str, Any]:
    src = Image.open(image_path)
    has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
    rgb = _open_rgb(image_path)
    w, h = rgb.size
    ar = w / max(1, h)
    if abs(ar - 1.0) < 0.03:
        suggested = "square_social_post"
    elif ar < 0.85:
        suggested = "portrait_story_poster"
    elif ar > 1.3:
        suggested = "landscape_banner"
    else:
        suggested = "near_square"

    mean_luma, std_luma = _brightness_stats(rgb)
    palette = dominant_colors(rgb, count=5)
    text_score = _text_likeness(rgb)

    return {
        "path": str(image_path),
        "dimensions": {"width": w, "height": h, "aspect": round(ar, 4)},
        "has_alpha": bool(has_alpha),
        "mean_luma": round(mean_luma, 2),
        "contrast_std": round(std_luma, 2),
        "dominant_colors": [{"hex": h, "share": s} for h, s in palette],
        "text_likeness": round(text_score, 4),
        "has_text_likely": text_score > 0.06,
        "suggested_type": suggested,
    }


def write_report(report: Dict[str, Any], out_dir: str) -> str:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    p = os.path.join(out_dir, "report.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    return p


# =========================================================================== #
# V2: Structural diff with patch proposals.
# =========================================================================== #
#
# v2 expands the simple grid-based color diff into a STRUCTURAL diff that
# answers: "what KIND of difference is this?" Categories:
#
#   - GEOMETRY : element exists in both but at a different position/size
#   - COLOR    : same element, different fill
#   - MISSING  : reference has content, candidate is blank (or very plain) here
#   - EXTRA    : candidate has content, reference is blank
#   - TEXT     : high edge-density region (text-like) differs
#   - PHOTO    : large continuous filled region (photo-like) differs
#
# Heuristics use only Pillow + stdlib. They are CHEAP and approximate — meant
# to RANK actions for an executor agent, not to give pixel-perfect locations.

# Tuning constants.
V2_GRID: Tuple[int, int] = (12, 12)          # fine grid for v2
V2_MIN_DIFF = 0.03                            # ignore cells below this
V2_TEXT_EDGE_THRESHOLD = 0.10                 # edge density => text-like
V2_PHOTO_SAT_THRESHOLD = 32                   # mean saturation => photo-like
V2_PHOTO_STD_THRESHOLD = 22                   # luma stddev => photo-like (rich)
V2_BLANK_STD_THRESHOLD = 6                    # luma stddev below this = blank
V2_GEOMETRY_MIN_NEIGHBORS = 2                 # cluster size for geometry

OVERLAY_COLORS_V2: Dict[str, Tuple[int, int, int]] = {
    "geometry": (40, 200, 90),    # green
    "color":    (60, 130, 255),   # blue
    "missing":  (230, 40, 40),    # red
    "extra":    (245, 210, 40),   # yellow
    "text":     (200, 80, 220),   # magenta
    "photo":    (255, 140, 0),    # orange
    "unknown":  (140, 140, 140),  # gray
}


# --------------------------------------------------------------------------- #
# Cheap per-region stats.
# --------------------------------------------------------------------------- #

def _region_stats(im: Image.Image) -> Dict[str, float]:
    """Return cheap stats for one cropped region (edge density, sat, luma std)."""
    if im.mode != "RGB":
        im = im.convert("RGB")
    w, h = im.size
    if w < 2 or h < 2:
        return {"edge_density": 0.0, "mean_sat": 0.0, "luma_std": 0.0, "mean_luma": 0.0}

    # Downsample big regions for speed (cap to 128x128).
    if max(w, h) > 128:
        scale = 128 / float(max(w, h))
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
        w, h = im.size

    gray = im.convert("L")
    px = gray.load()
    rgb_px = im.load()
    edge_hits = 0
    total = 0
    luma_sum = 0
    luma_sq = 0
    sat_sum = 0
    for y in range(0, h - 1, 1):
        for x in range(0, w - 1, 1):
            p = px[x, y]
            q = px[x + 1, y]
            r = px[x, y + 1]
            d = max(abs(p - q), abs(p - r))
            if d > 50:
                edge_hits += 1
            luma_sum += p
            luma_sq += p * p
            rr, gg, bb = rgb_px[x, y]
            mx = max(rr, gg, bb)
            mn = min(rr, gg, bb)
            sat_sum += (mx - mn)
            total += 1
    if total == 0:
        return {"edge_density": 0.0, "mean_sat": 0.0, "luma_std": 0.0, "mean_luma": 0.0}
    mean_l = luma_sum / total
    var_l = max(0.0, (luma_sq / total) - mean_l * mean_l)
    return {
        "edge_density": edge_hits / total,
        "mean_sat": sat_sum / total,
        "luma_std": math.sqrt(var_l),
        "mean_luma": mean_l,
    }


# --------------------------------------------------------------------------- #
# Region detection.
# --------------------------------------------------------------------------- #

def detect_text_regions(img: Image.Image, grid: Tuple[int, int] = V2_GRID) -> List[Dict[str, Any]]:
    """Return bbox-style dicts for cells whose edge density looks text-like."""
    return _detect_regions_by(img, grid, lambda s: s["edge_density"] >= V2_TEXT_EDGE_THRESHOLD)


def detect_image_regions(img: Image.Image, grid: Tuple[int, int] = V2_GRID) -> List[Dict[str, Any]]:
    """Return bbox-style dicts for cells whose saturation + variance look photo-like."""
    return _detect_regions_by(
        img,
        grid,
        lambda s: s["mean_sat"] >= V2_PHOTO_SAT_THRESHOLD and s["luma_std"] >= V2_PHOTO_STD_THRESHOLD,
    )


def _detect_regions_by(
    img: Image.Image,
    grid: Tuple[int, int],
    pred,
) -> List[Dict[str, Any]]:
    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    cols, rows = grid
    cw = w / cols
    ch = h / rows
    out: List[Dict[str, Any]] = []
    for ry in range(rows):
        for cx in range(cols):
            x0 = int(round(cx * cw))
            y0 = int(round(ry * ch))
            x1 = min(int(round((cx + 1) * cw)), w)
            y1 = min(int(round((ry + 1) * ch)), h)
            crop = img.crop((x0, y0, x1, y1))
            s = _region_stats(crop)
            if pred(s):
                out.append({
                    "row": ry,
                    "col": cx,
                    "box": [x0, y0, x1, y1],
                    "stats": {k: round(v, 4) for k, v in s.items()},
                })
    return out


# --------------------------------------------------------------------------- #
# Per-cell classification.
# --------------------------------------------------------------------------- #

def classify_diff(
    ref: Image.Image,
    cand: Image.Image,
    box: Tuple[int, int, int, int],
) -> Dict[str, Any]:
    """Classify the difference inside a region as one of:
       geometry | color | missing | extra | text | photo | unknown.

    Returns a dict with 'kind', 'confidence', and the underlying stats so the
    executor can make a fully-informed decision.
    """
    rc = ref.crop(box)
    cc = cand.crop(box)
    s_ref = _region_stats(rc)
    s_cand = _region_stats(cc)

    ref_avg = _avg_color(rc)
    cand_avg = _avg_color(cc)
    color_dist = _rgb_distance(ref_avg, cand_avg)

    diff_amount = pixel_diff(rc, cc)

    ref_blank = s_ref["luma_std"] < V2_BLANK_STD_THRESHOLD
    cand_blank = s_cand["luma_std"] < V2_BLANK_STD_THRESHOLD

    # MISSING: reference has rich content, candidate is blank.
    if not ref_blank and cand_blank:
        return _cls(
            "missing", 0.85, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
            note="reference region has content but candidate appears blank/flat",
        )
    # EXTRA: candidate added content where reference was blank.
    if ref_blank and not cand_blank:
        return _cls(
            "extra", 0.85, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
            note="candidate has content but reference is blank/flat here",
        )

    # TEXT: high edge density on either side AND meaningful diff.
    if (s_ref["edge_density"] >= V2_TEXT_EDGE_THRESHOLD
            or s_cand["edge_density"] >= V2_TEXT_EDGE_THRESHOLD):
        # Text + huge edge_density gap = text shape/font wrong.
        return _cls(
            "text", 0.7, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
            note="region looks text-like in at least one image",
        )

    # PHOTO: rich color + high variance on reference side.
    photo_like_ref = s_ref["mean_sat"] >= V2_PHOTO_SAT_THRESHOLD and s_ref["luma_std"] >= V2_PHOTO_STD_THRESHOLD
    photo_like_cand = s_cand["mean_sat"] >= V2_PHOTO_SAT_THRESHOLD and s_cand["luma_std"] >= V2_PHOTO_STD_THRESHOLD
    if photo_like_ref or photo_like_cand:
        # If only one side is photo-like => it's effectively missing/extra photo.
        if photo_like_ref and not photo_like_cand:
            return _cls(
                "missing", 0.8, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
                note="reference contains photo-like content but candidate is plainer",
                subtype="photo",
            )
        if photo_like_cand and not photo_like_ref:
            return _cls(
                "extra", 0.8, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
                note="candidate contains photo-like content but reference is plainer",
                subtype="photo",
            )
        return _cls(
            "photo", 0.7, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
            note="photo-like region in both, content differs",
        )

    # COLOR: same brightness/edge profile, different mean color.
    edge_close = abs(s_ref["edge_density"] - s_cand["edge_density"]) < 0.04
    std_close = abs(s_ref["luma_std"] - s_cand["luma_std"]) < 8
    if edge_close and std_close and color_dist > 0.05:
        return _cls(
            "color", 0.75, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
            note="similar structure, different fill color",
        )

    # GEOMETRY: structural metrics shifted (luma_std or edge_density jump) but
    # color stayed similar => element likely moved/resized.
    if (abs(s_ref["luma_std"] - s_cand["luma_std"]) > 10
            or abs(s_ref["edge_density"] - s_cand["edge_density"]) > 0.04):
        return _cls(
            "geometry", 0.6, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
            note="structural profile shifted; element likely moved or resized",
        )

    return _cls(
        "unknown", 0.3, s_ref, s_cand, ref_avg, cand_avg, color_dist, diff_amount,
        note="diff present but did not match a known pattern",
    )


def _cls(
    kind: str,
    confidence: float,
    s_ref: Dict[str, float],
    s_cand: Dict[str, float],
    ref_avg: Tuple[int, int, int],
    cand_avg: Tuple[int, int, int],
    color_dist: float,
    diff_amount: float,
    note: str = "",
    subtype: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "kind": kind,
        "subtype": subtype,
        "confidence": round(confidence, 3),
        "note": note,
        "diff": round(diff_amount, 4),
        "diff_pct": round(diff_amount * 100.0, 2),
        "color_distance": round(color_dist, 4),
        "ref_avg_hex": _rgb_to_hex(*ref_avg),
        "cand_avg_hex": _rgb_to_hex(*cand_avg),
        "ref_stats": {k: round(v, 4) for k, v in s_ref.items()},
        "cand_stats": {k: round(v, 4) for k, v in s_cand.items()},
    }


# --------------------------------------------------------------------------- #
# Clustering: merge neighboring diff cells of same kind into bigger regions.
# --------------------------------------------------------------------------- #

def _cluster_cells(cells: List[Dict[str, Any]], grid: Tuple[int, int]) -> List[Dict[str, Any]]:
    """Union-find merge of 4-neighbor cells with same 'kind'."""
    cols, rows = grid
    by_rc: Dict[Tuple[int, int], Dict[str, Any]] = {(c["row"], c["col"]): c for c in cells}
    parent: Dict[Tuple[int, int], Tuple[int, int]] = {k: k for k in by_rc}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for (ry, cx), c in by_rc.items():
        for (dy, dx) in [(0, 1), (1, 0), (-1, 0), (0, -1)]:
            n = (ry + dy, cx + dx)
            if n in by_rc and by_rc[n]["classification"]["kind"] == c["classification"]["kind"]:
                union((ry, cx), n)

    groups: Dict[Tuple[int, int], List[Dict[str, Any]]] = {}
    for k in by_rc:
        r = find(k)
        groups.setdefault(r, []).append(by_rc[k])

    clusters: List[Dict[str, Any]] = []
    for members in groups.values():
        kind = members[0]["classification"]["kind"]
        confs = [m["classification"]["confidence"] for m in members]
        # Bounding box across members.
        xs = [m["box"][0] for m in members] + [m["box"][2] for m in members]
        ys = [m["box"][1] for m in members] + [m["box"][3] for m in members]
        box = [min(xs), min(ys), max(xs), max(ys)]
        diffs = [m["diff"] for m in members]
        # impact = total area-weighted diff (bigger or worse => higher impact)
        area = max(1, (box[2] - box[0]) * (box[3] - box[1]))
        impact = (sum(diffs) / len(diffs)) * area
        notes = list({m["classification"]["note"] for m in members if m["classification"]["note"]})
        ref_hex = members[0]["ref_avg_hex"]
        cand_hex = members[0]["cand_avg_hex"]
        subtype = next((m["classification"].get("subtype") for m in members if m["classification"].get("subtype")), None)
        clusters.append({
            "kind": kind,
            "subtype": subtype,
            "box": box,
            "cells": len(members),
            "avg_diff": round(sum(diffs) / len(diffs), 4),
            "max_diff": round(max(diffs), 4),
            "confidence": round(sum(confs) / len(confs), 3),
            "impact": round(impact, 2),
            "ref_avg_hex": ref_hex,
            "cand_avg_hex": cand_hex,
            "notes": notes,
        })
    clusters.sort(key=lambda c: -c["impact"])
    return clusters


# --------------------------------------------------------------------------- #
# Patch proposals.
# --------------------------------------------------------------------------- #

def generate_patch_proposals(
    ref: Image.Image,
    cand: Image.Image,
    grid: Tuple[int, int] = V2_GRID,
    min_diff: float = V2_MIN_DIFF,
) -> Dict[str, Any]:
    """Run the full v2 structural analysis. Returns:
        {
          "cells":    [...],   # per-cell classification (whole grid)
          "clusters": [...],   # merged neighboring same-kind groups
          "patches":  [...],   # actionable, prioritized list
        }
    """
    if cand.size != ref.size:
        cand = cand.resize(ref.size, Image.BILINEAR)
    w, h = ref.size
    cols, rows = grid
    cw = w / cols
    ch = h / rows

    cells: List[Dict[str, Any]] = []
    for ry in range(rows):
        for cx in range(cols):
            x0 = int(round(cx * cw))
            y0 = int(round(ry * ch))
            x1 = min(int(round((cx + 1) * cw)), w)
            y1 = min(int(round((ry + 1) * ch)), h)
            box = (x0, y0, x1, y1)
            ca = ref.crop(box)
            cb = cand.crop(box)
            diff = pixel_diff(ca, cb)
            if diff < min_diff:
                cells.append({
                    "row": ry, "col": cx, "box": [x0, y0, x1, y1],
                    "diff": round(diff, 4), "diff_pct": round(diff * 100.0, 2),
                    "ref_avg_hex": _rgb_to_hex(*_avg_color(ca)),
                    "cand_avg_hex": _rgb_to_hex(*_avg_color(cb)),
                    "classification": {"kind": "match", "confidence": 1.0, "note": ""},
                })
                continue
            cls = classify_diff(ref, cand, box)
            cells.append({
                "row": ry, "col": cx, "box": [x0, y0, x1, y1],
                "diff": cls["diff"], "diff_pct": cls["diff_pct"],
                "ref_avg_hex": cls["ref_avg_hex"],
                "cand_avg_hex": cls["cand_avg_hex"],
                "classification": cls,
            })

    diff_cells = [c for c in cells if c["classification"]["kind"] != "match"]
    clusters = _cluster_cells(diff_cells, grid)
    patches = _clusters_to_patches(clusters, ref.size)
    return {"cells": cells, "clusters": clusters, "patches": patches}


# Priority ordering — fix MISSING before GEOMETRY before COLOR.
_KIND_PRIORITY: Dict[str, int] = {
    "missing":  100,
    "extra":    90,
    "photo":    80,
    "text":     70,
    "geometry": 60,
    "color":    40,
    "unknown":  10,
}


def _clusters_to_patches(
    clusters: List[Dict[str, Any]],
    canvas_size: Tuple[int, int],
) -> List[Dict[str, Any]]:
    """Translate clusters into actionable patches the executor can apply."""
    w, h = canvas_size
    patches: List[Dict[str, Any]] = []
    for c in clusters:
        kind = c["kind"]
        box = c["box"]
        loc = _region_location_px(box, w, h)
        base_priority = _KIND_PRIORITY.get(kind, 10)
        # Boost priority by impact magnitude.
        priority = base_priority + min(50, int(c["impact"] / 5000.0))
        params: Dict[str, Any] = {
            "region_label": loc,
            "ref_hex": c["ref_avg_hex"],
            "cand_hex": c["cand_avg_hex"],
            "avg_diff_pct": round(c["avg_diff"] * 100.0, 2),
            "max_diff_pct": round(c["max_diff"] * 100.0, 2),
            "cells": c["cells"],
            "confidence": c["confidence"],
        }
        if c.get("subtype"):
            params["subtype"] = c["subtype"]
        if kind == "missing":
            action = "add_element"
            params["hint"] = "photo" if c.get("subtype") == "photo" or _is_largish(box, w, h) else "graphic"
        elif kind == "extra":
            action = "remove_element"
            params["hint"] = "candidate has content the reference does not"
        elif kind == "photo":
            action = "replace_photo"
            params["hint"] = "swap photo content; check subject and crop"
        elif kind == "text":
            action = "fix_text"
            params["hint"] = "verify copy, font weight, size, color, kerning"
        elif kind == "geometry":
            action = "move_or_resize_element"
            # Estimate translation by centroid of ref vs cand brightness peaks (cheap fallback: 0).
            params["dx_hint"] = 0
            params["dy_hint"] = 0
            params["hint"] = "element appears moved/resized; verify x,y,w,h"
        elif kind == "color":
            action = "change_color"
            params["from"] = c["cand_avg_hex"]
            params["to"] = c["ref_avg_hex"]
        else:
            action = "investigate"
            params["hint"] = "no confident classification"
        patches.append({
            "priority": priority,
            "action": action,
            "kind": kind,
            "region": {"box": box, "label": loc},
            "params": params,
            "impact": c["impact"],
            "notes": c["notes"],
        })
    patches.sort(key=lambda p: (-p["priority"], -p["impact"]))
    for i, p in enumerate(patches):
        p["rank"] = i + 1
    return patches


def _is_largish(box: List[int], w: int, h: int) -> bool:
    area = max(1, (box[2] - box[0]) * (box[3] - box[1]))
    return area / float(w * h) > 0.08


def _region_location_px(box: List[int], w: int, h: int) -> str:
    cx = (box[0] + box[2]) / 2.0 / w
    cy = (box[1] + box[3]) / 2.0 / h
    if cx < 1 / 3:
        hloc = "left"
    elif cx < 2 / 3:
        hloc = "center"
    else:
        hloc = "right"
    if cy < 1 / 3:
        vloc = "top"
    elif cy < 2 / 3:
        vloc = "middle"
    else:
        vloc = "bottom"
    if hloc == "center" and vloc == "middle":
        return "center"
    return f"{vloc}-{hloc}"


# --------------------------------------------------------------------------- #
# Overlay (classified colors).
# --------------------------------------------------------------------------- #

def make_classified_overlay(
    ref: Image.Image,
    cells: List[Dict[str, Any]],
    clusters: List[Dict[str, Any]],
    out_path: str,
    top_clusters: int = 10,
) -> str:
    base = ref.copy().convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Light per-cell tint by kind.
    for cell in cells:
        kind = cell["classification"]["kind"]
        if kind == "match":
            continue
        col = OVERLAY_COLORS_V2.get(kind, OVERLAY_COLORS_V2["unknown"])
        x0, y0, x1, y1 = cell["box"]
        draw.rectangle([x0, y0, x1, y1], fill=(col[0], col[1], col[2], 60))

    # Cluster boxes (strong borders + label).
    font = _try_font(max(14, base.size[0] // 60))
    for i, c in enumerate(clusters[:top_clusters]):
        col = OVERLAY_COLORS_V2.get(c["kind"], OVERLAY_COLORS_V2["unknown"])
        x0, y0, x1, y1 = c["box"]
        for k in range(3):
            draw.rectangle([x0 + k, y0 + k, x1 - k, y1 - k], outline=(col[0], col[1], col[2], 255))
        label = f"#{i+1} {c['kind'].upper()} {c['avg_diff']*100:.0f}%"
        try:
            bbox = draw.textbbox((x0 + 6, y0 + 6), label, font=font)
        except Exception:
            bbox = (x0 + 6, y0 + 6, x0 + 120, y0 + 22)
        draw.rectangle(bbox, fill=(0, 0, 0, 210))
        draw.text((x0 + 6, y0 + 6), label, fill=(col[0], col[1], col[2], 255), font=font)

    # Legend strip at top.
    legend_h = max(28, base.size[1] // 40)
    legend = Image.new("RGBA", (base.size[0], legend_h), (0, 0, 0, 220))
    ld = ImageDraw.Draw(legend)
    items = [("missing", "MISSING"), ("extra", "EXTRA"), ("photo", "PHOTO"),
             ("text", "TEXT"), ("geometry", "GEOMETRY"), ("color", "COLOR")]
    x = 8
    small = _try_font(max(11, base.size[0] // 90))
    for key, lab in items:
        col = OVERLAY_COLORS_V2[key]
        ld.rectangle([x, 6, x + 18, legend_h - 6], fill=(col[0], col[1], col[2], 255))
        ld.text((x + 24, 6), lab, fill=(255, 255, 255, 255), font=small)
        x += 24 + (len(lab) * 9) + 16

    composed = Image.alpha_composite(base, overlay).convert("RGBA")
    composed.paste(legend, (0, 0), legend)
    composed.convert("RGB").save(out_path, "PNG")
    return out_path


# --------------------------------------------------------------------------- #
# Top-level compare-v2.
# --------------------------------------------------------------------------- #

def compare_v2(
    ref_path: str,
    cand_path: str,
    grid: Tuple[int, int] = V2_GRID,
) -> Dict[str, Any]:
    """Structural compare returning per-cell classification, clusters, and patches."""
    ref = _open_rgb(ref_path)
    cand = _open_rgb(cand_path)
    orig_ref_size = ref.size
    orig_cand_size = cand.size

    ref_d = _downsample(ref)
    cand_d = cand.resize(ref_d.size, Image.BILINEAR)

    overall = pixel_diff(ref_d, cand_d)

    structural = generate_patch_proposals(ref_d, cand_d, grid=grid)
    text_regions_ref = detect_text_regions(ref_d, grid=grid)
    photo_regions_ref = detect_image_regions(ref_d, grid=grid)

    # Reference-aware metric: weight diffs in photo + text regions more.
    weighted_diff = _weighted_diff(structural["cells"], text_regions_ref, photo_regions_ref)

    verdict = _verdict_v2(weighted_diff, structural["patches"])

    return {
        "version": 2,
        "summary": {
            "overall_diff": round(overall, 4),
            "overall_diff_pct": round(overall * 100.0, 2),
            "weighted_diff": round(weighted_diff, 4),
            "weighted_diff_pct": round(weighted_diff * 100.0, 2),
            "verdict": verdict,
            "grid": list(grid),
            "patch_count": len(structural["patches"]),
            "kind_counts": _kind_counts(structural["patches"]),
        },
        "sizes": {
            "reference": list(orig_ref_size),
            "candidate": list(orig_cand_size),
            "compared_at": list(ref_d.size),
        },
        "reference_regions": {
            "text": text_regions_ref,
            "photo": photo_regions_ref,
        },
        "cells": structural["cells"],
        "clusters": structural["clusters"],
        "patches": structural["patches"],
    }


def _weighted_diff(
    cells: List[Dict[str, Any]],
    text_regions: List[Dict[str, Any]],
    photo_regions: List[Dict[str, Any]],
) -> float:
    if not cells:
        return 0.0
    photo_set = {(r["row"], r["col"]) for r in photo_regions}
    text_set = {(r["row"], r["col"]) for r in text_regions}
    total_w = 0.0
    total_d = 0.0
    for c in cells:
        rc = (c["row"], c["col"])
        w = 1.0
        if rc in photo_set:
            w = 3.0
        elif rc in text_set:
            w = 2.0
        total_w += w
        total_d += c["diff"] * w
    return total_d / max(total_w, 1.0)


def _kind_counts(patches: List[Dict[str, Any]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for p in patches:
        out[p["kind"]] = out.get(p["kind"], 0) + 1
    return out


def _verdict_v2(weighted_diff: float, patches: List[Dict[str, Any]]) -> str:
    has_missing = any(p["kind"] in ("missing", "extra") for p in patches)
    pct = weighted_diff * 100.0
    if pct < 3 and not has_missing:
        return "excellent_match"
    if has_missing:
        return "needs_revision_missing_element"
    if pct < 10:
        return "minor_tweaks_needed"
    if pct < 25:
        return "needs_revision"
    return "composition_issue_replan"


def write_report_v2(report: Dict[str, Any], out_dir: str) -> Dict[str, str]:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    p_report = os.path.join(out_dir, "report_v2.json")
    p_patches = os.path.join(out_dir, "patches.json")
    with open(p_report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    with open(p_patches, "w", encoding="utf-8") as f:
        json.dump(report["patches"], f, indent=2, ensure_ascii=False)
    return {"report": p_report, "patches": p_patches}
