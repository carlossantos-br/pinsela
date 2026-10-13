"""Reference-image design DNA analyzer.

Given a reference image (PNG/JPG bytes or path), extract a *machine-readable*
description of its visual structure so the agent loop does not have to iterate
27 times to detect basic positions, palette and region layout.

This module deliberately depends only on Pillow + numpy. No OpenCV, no ML
models, no real OCR. The goal is a fast (sub-second), deterministic heuristic
analysis that the agent loop can consume directly when composing a new
``pinsela_native_v1`` document.

Public entry points
-------------------
* ``analyze_reference(source) -> dict`` — full DNA report
* ``extract_palette(source, k=5) -> list[dict]`` — palette only
* ``compare_layouts(ref_source, candidate_doc) -> dict`` — alignment delta
* ``render_overlay(source, analysis, output_path)`` — visualization helper

The returned dict shape is documented on ``analyze_reference``.
"""

from __future__ import annotations

import base64
import binascii
import io
import math
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Union

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


# --------------------------------------------------------------------------- #
# Public types.
# --------------------------------------------------------------------------- #

# NOTE: ``ImageSource`` is a *runtime* alias used by isinstance() so we keep it
# as a typing.Union for compatibility with Python 3.9 (the API venv).
ImageSource = Union[bytes, str, Path, Image.Image]

# Region "kinds" used in the output schema. Documented in the skill ref.
KIND_TEXT = "text"
KIND_IMAGE = "image"
KIND_IMAGE_PORTRAIT = "image_portrait"
KIND_IMAGE_OBJECT = "image_object"
KIND_SHAPE = "shape"

# Working resolution. Reference images can be 6000px tall; processing the full
# resolution is wasteful. We downscale so the longest side is <= MAX_DIM, run
# all heuristics, then rescale bboxes back to original coordinates.
MAX_DIM = 1024
# Two thresholds: blobs smaller than MIN_RAW_BLOB_FRAC are dropped before any
# merging (per-glyph speckle). After merging, blobs below MIN_MERGED_BLOB_FRAC
# are dropped as noise. Calibrated on social-post references where the typical
# canvas area at working resolution is ~590k px and a body-text line is
# ~25k px (~4 %) while a single glyph is ~600 px (~0.1 %).
MIN_RAW_BLOB_FRAC = 0.0008  # ~470 px on a 1024-edge canvas
MIN_MERGED_BLOB_FRAC = 0.003  # ~1770 px on a 1024-edge canvas
BG_TOLERANCE = 18  # max L1 distance from bg colour considered background


# --------------------------------------------------------------------------- #
# Loading helpers.
# --------------------------------------------------------------------------- #

def _load_image(source: ImageSource) -> Image.Image:
    """Load any supported source into an RGB Pillow image."""
    if isinstance(source, Image.Image):
        return source.convert("RGB")
    if isinstance(source, (str, Path)):
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"reference image not found: {path}")
        return Image.open(path).convert("RGB")
    if isinstance(source, (bytes, bytearray)):
        if not source:
            raise ValueError("empty image bytes")
        return Image.open(io.BytesIO(bytes(source))).convert("RGB")
    raise TypeError(f"unsupported source type: {type(source).__name__}")


def _decode_base64(value: str) -> bytes:
    raw = (value or "").strip()
    if raw.startswith("data:"):
        idx = raw.find(",")
        if idx == -1:
            raise ValueError("invalid data URI")
        raw = raw[idx + 1 :]
    try:
        return base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid base64: {exc}") from exc


def load_image_from_request(payload: dict, *, allowed_root: Path | None = None) -> Image.Image:
    """Accept either ``image_base64`` or ``image_path`` payload keys.

    ``image_path`` is only accepted with ``allowed_root`` and must stay inside it
    (it comes from an HTTP request: it must not read arbitrary files from disk).
    """
    if not isinstance(payload, dict):
        raise ValueError("payload must be a dict")
    b64 = payload.get("image_base64")
    if isinstance(b64, str) and b64.strip():
        return _load_image(_decode_base64(b64))
    path = payload.get("image_path")
    if isinstance(path, str) and path.strip():
        if allowed_root is None:
            raise ValueError("image_path_not_allowed")
        from pinsela.security import resolve_under

        try:
            confined = resolve_under(allowed_root, path.strip(), must_exist=True)
        except FileNotFoundError:
            raise FileNotFoundError("image_path_not_found") from None
        except ValueError:
            raise ValueError("image_path_outside_data_root") from None
        return _load_image(confined)
    raise ValueError("payload requires either 'image_base64' or 'image_path'")


# --------------------------------------------------------------------------- #
# Color helpers.
# --------------------------------------------------------------------------- #

def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, int(round(v)))) for v in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def _hex_to_rgb(hexstr: str) -> tuple[int, int, int]:
    s = hexstr.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        raise ValueError(f"invalid hex: {hexstr}")
    return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = (v / 255.0 for v in rgb)
    # Rec. 709 luma
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _is_warm_neutral(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    # warm = R >= G >= B with mid-low saturation
    return r >= g >= b and (r - b) >= 15 and (r - b) <= 90


def _is_gold(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    return r >= 140 and g >= 90 and b <= 110 and r > b + 30


def _classify_color_logic(palette: list[dict]) -> str:
    """Coarse description of the overall colour story."""
    bg = palette[0]["rgb"]
    accents = [p for p in palette[1:] if p["share"] >= 0.02]
    has_gold = any(_is_gold(p["rgb"]) for p in accents)
    bg_warm = _is_warm_neutral(bg) or _luminance(bg) > 0.75
    if bg_warm and has_gold:
        return "warm_neutral_with_gold_accent"
    if _luminance(bg) < 0.2:
        return "dark_dominant_high_contrast"
    if all(_luminance(p["rgb"]) > 0.6 for p in palette[:3]):
        return "light_pastel_palette"
    # default
    return "balanced_neutral_with_accents"


# --------------------------------------------------------------------------- #
# Palette extraction.
# --------------------------------------------------------------------------- #

def extract_palette(source: ImageSource, k: int = 5) -> list[dict]:
    """Return ``k`` dominant colours with their proportional share.

    Uses Pillow's median-cut quantizer which is fast and stable. Each entry::

        {"hex": "#RRGGBB", "rgb": (r,g,b), "share": 0.42, "role": "..."}
    """
    img = _load_image(source)
    work = _resize_for_processing(img)
    quant = work.quantize(colors=max(2, k), method=Image.MEDIANCUT)
    palette_bytes = quant.getpalette() or []
    pixels = np.array(quant)
    counts = np.bincount(pixels.flatten(), minlength=k)
    total = float(counts.sum()) or 1.0

    entries: list[dict] = []
    for idx in range(k):
        share = float(counts[idx]) / total
        if share <= 0:
            continue
        base = idx * 3
        rgb = (
            int(palette_bytes[base]),
            int(palette_bytes[base + 1]),
            int(palette_bytes[base + 2]),
        )
        entries.append(
            {
                "hex": _rgb_to_hex(rgb),
                "rgb": rgb,
                "share": round(share, 4),
            }
        )
    entries.sort(key=lambda e: e["share"], reverse=True)
    return _label_palette_roles(entries)


def _label_palette_roles(palette: list[dict]) -> list[dict]:
    """Assign semantic roles: background / accent_primary / text_primary..."""
    if not palette:
        return palette
    out: list[dict] = []
    bg = palette[0]
    bg["role"] = "background"
    out.append(bg)

    # accent: first non-background colour with reasonable saturation
    used_roles = {"background"}
    accent_idx = 1
    for entry in palette[1:]:
        rgb = entry["rgb"]
        r, g, b = rgb
        sat = (max(rgb) - min(rgb)) / (max(rgb) + 1)
        lum = _luminance(rgb)
        if "accent_primary" not in used_roles and sat > 0.18 and 0.15 < lum < 0.85:
            entry["role"] = "accent_primary"
            used_roles.add("accent_primary")
        elif "text_primary" not in used_roles and lum < 0.25:
            entry["role"] = "text_primary"
            used_roles.add("text_primary")
        elif "highlight" not in used_roles and lum > 0.9 and "background" in used_roles:
            entry["role"] = "highlight"
            used_roles.add("highlight")
        else:
            entry["role"] = f"accent_{accent_idx}"
            accent_idx += 1
        out.append(entry)
    return out


# --------------------------------------------------------------------------- #
# Background detection.
# --------------------------------------------------------------------------- #

def _resize_for_processing(img: Image.Image, max_dim: int = MAX_DIM) -> Image.Image:
    w, h = img.size
    longest = max(w, h)
    if longest <= max_dim:
        return img
    scale = max_dim / float(longest)
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return img.resize(new_size, Image.LANCZOS)


def _detect_background(arr: np.ndarray) -> tuple[int, int, int]:
    """Estimate the canvas background colour.

    Strategy:
    1. Compute the *dominant* colour over the whole image (median-cut, 5 bins).
       If one bin dominates (>50 % share) and is reasonably light, that's the
       background. This handles cases like a brown decorative border framing a
       beige canvas — corner sampling would wrongly pick the border.
    2. Otherwise sample inset corners + a row of mid-column points and pick the
       most common bucketed colour. We deliberately *inset* the samples ~3 %
       inside the canvas to skip thin photographic borders.
    """
    h, w = arr.shape[:2]

    # --- 1. Dominant-colour pass via median-cut ----------------------------
    try:
        thumb = Image.fromarray(arr).resize((128, 128), Image.LANCZOS).quantize(
            colors=5, method=Image.MEDIANCUT
        )
        pal_bytes = thumb.getpalette() or []
        flat = np.array(thumb).flatten()
        counts = np.bincount(flat, minlength=5)
        top_idx = int(counts.argmax())
        top_share = float(counts[top_idx]) / float(counts.sum() or 1)
        top_rgb = (
            int(pal_bytes[top_idx * 3]),
            int(pal_bytes[top_idx * 3 + 1]),
            int(pal_bytes[top_idx * 3 + 2]),
        )
        if top_share >= 0.45:
            return top_rgb
    except Exception:
        pass

    # --- 2. Inset corner / edge sampling ----------------------------------
    inset_y = max(2, int(h * 0.03))
    inset_x = max(2, int(w * 0.03))
    sample_pts = [
        (inset_y, inset_x),
        (inset_y, w - inset_x - 1),
        (h - inset_y - 1, inset_x),
        (h - inset_y - 1, w - inset_x - 1),
        (inset_y, int(w * 0.5)),
        (h - inset_y - 1, int(w * 0.5)),
        (int(h * 0.5), inset_x),
        (int(h * 0.5), w - inset_x - 1),
    ]
    samples: list[tuple[int, int, int]] = []
    for y, x in sample_pts:
        y0, y1 = max(0, y - 4), min(h, y + 5)
        x0, x1 = max(0, x - 4), min(w, x + 5)
        patch = arr[y0:y1, x0:x1].reshape(-1, 3)
        mean = patch.mean(axis=0)
        bucket = tuple(int(round(v / 8.0)) * 8 for v in mean)
        samples.append(bucket)  # type: ignore[arg-type]
    common = Counter(samples).most_common(1)[0][0]
    return tuple(int(c) for c in common)  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# Region (blob) detection.
# --------------------------------------------------------------------------- #

def _foreground_mask(arr: np.ndarray, bg_rgb: tuple[int, int, int]) -> np.ndarray:
    """Pixels are foreground if their L1 distance to bg exceeds tolerance."""
    diff = np.abs(arr.astype(np.int16) - np.asarray(bg_rgb, dtype=np.int16))
    l1 = diff.sum(axis=2)
    return l1 > BG_TOLERANCE * 3  # ~tolerance per channel


def _horizontal_strip_bands(mask: np.ndarray, min_gap_rows: int = 8) -> list[tuple[int, int]]:
    """Find vertical (y) ranges where foreground density is non-trivial.

    Returns list of ``(y_start, y_end)`` strips separated by *gap* rows where
    the foreground density falls below the threshold. Used as a pre-pass that
    prevents connected-components from merging the logo + title + photo into
    one huge blob just because they're vertically adjacent.
    """
    row_density = mask.mean(axis=1)
    # rows with >2 % foreground count as "occupied"
    occupied = row_density > 0.02
    bands: list[tuple[int, int]] = []
    in_band = False
    start = 0
    gap_counter = 0
    for y, occ in enumerate(occupied):
        if occ:
            if not in_band:
                start = y
                in_band = True
            gap_counter = 0
        else:
            if in_band:
                gap_counter += 1
                if gap_counter >= min_gap_rows:
                    bands.append((start, y - gap_counter + 1))
                    in_band = False
                    gap_counter = 0
    if in_band:
        bands.append((start, len(occupied)))
    return bands


def _morph_close(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    """Quick dilate-then-erode using Pillow filters."""
    img = Image.fromarray((mask.astype(np.uint8)) * 255, mode="L")
    img = img.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    img = img.filter(ImageFilter.MinFilter(radius * 2 + 1))
    return np.asarray(img) > 127


def _connected_components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """Two-pass connected-components labelling. Returns list of (x,y,w,h,area).

    Pure numpy/python — avoids the scipy dependency. Suitable for ~1024px
    working canvases (< 1.1 M pixels) where iterating in Python is fine.
    """
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    parent: list[int] = [0]  # 0 = background

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> int:
        ra, rb = find(a), find(b)
        if ra == rb:
            return ra
        if ra < rb:
            parent[rb] = ra
            return ra
        parent[ra] = rb
        return rb

    next_label = 1
    # first pass
    for y in range(h):
        row = mask[y]
        prev_row = mask[y - 1] if y > 0 else None
        for x in range(w):
            if not row[x]:
                continue
            up = labels[y - 1, x] if y > 0 and prev_row is not None and prev_row[x] else 0
            left = labels[y, x - 1] if x > 0 and row[x - 1] else 0
            if up == 0 and left == 0:
                parent.append(next_label)
                labels[y, x] = next_label
                next_label += 1
            elif up != 0 and left != 0:
                labels[y, x] = union(up, left)
            else:
                labels[y, x] = up or left

    # flatten
    flat = np.arange(len(parent), dtype=np.int32)
    for i in range(1, len(parent)):
        flat[i] = find(i)
    labels = flat[labels]

    # bbox per label
    blobs: dict[int, list[int]] = {}
    ys, xs = np.nonzero(labels)
    if ys.size == 0:
        return []
    lab_vals = labels[ys, xs]
    for lab in np.unique(lab_vals):
        sel = lab_vals == lab
        sub_y = ys[sel]
        sub_x = xs[sel]
        y0, y1 = int(sub_y.min()), int(sub_y.max())
        x0, x1 = int(sub_x.min()), int(sub_x.max())
        blobs[int(lab)] = [x0, y0, x1 - x0 + 1, y1 - y0 + 1, int(sub_y.size)]

    return [tuple(v) for v in blobs.values()]  # type: ignore[return-value]


def _merge_overlapping_horizontal_blobs(
    blobs: list[tuple[int, int, int, int, int]],
    canvas_w: int,
    canvas_h: int,
) -> list[tuple[int, int, int, int, int]]:
    """Group blobs whose vertical ranges overlap and that are horizontally close.

    Many text regions split into per-letter blobs; merging by vertical band
    reconstructs the line. We merge greedy: sort by y, then sweep.
    """
    if not blobs:
        return []
    items = sorted(blobs, key=lambda b: (b[1], b[0]))
    merged: list[list[int]] = []
    h_tol = max(8, int(canvas_h * 0.012))  # vertical proximity
    x_tol = max(20, int(canvas_w * 0.06))  # horizontal proximity
    for x, y, w, h, area in items:
        placed = False
        for group in merged:
            gx, gy, gw, gh, garea = group
            v_overlap = not (y + h < gy - h_tol or y > gy + gh + h_tol)
            x_close = not (x + w < gx - x_tol or x > gx + gw + x_tol)
            if v_overlap and x_close:
                nx = min(gx, x)
                ny = min(gy, y)
                nx2 = max(gx + gw, x + w)
                ny2 = max(gy + gh, y + h)
                group[0] = nx
                group[1] = ny
                group[2] = nx2 - nx
                group[3] = ny2 - ny
                group[4] = garea + area
                placed = True
                break
        if not placed:
            merged.append([x, y, w, h, area])
    return [tuple(g) for g in merged]  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# Region classification (text vs image vs object).
# --------------------------------------------------------------------------- #

def _sobel_edge_density(arr: np.ndarray, bbox: tuple[int, int, int, int]) -> float:
    """Edge density inside the bbox. Higher = text-like, lower = photo region."""
    x, y, w, h = bbox
    crop = arr[y : y + h, x : x + w]
    if crop.size == 0:
        return 0.0
    gray = crop.mean(axis=2).astype(np.float32)
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    edge = float(gx.mean() + gy.mean())
    return edge


def _color_variance(arr: np.ndarray, bbox: tuple[int, int, int, int]) -> float:
    x, y, w, h = bbox
    crop = arr[y : y + h, x : x + w]
    if crop.size == 0:
        return 0.0
    return float(crop.astype(np.float32).std())


def _aspect_ratio(bbox: tuple[int, int, int, int]) -> float:
    _, _, w, h = bbox
    if h == 0:
        return 0.0
    return w / float(h)


def _classify_region(
    arr: np.ndarray,
    bbox: tuple[int, int, int, int],
    canvas_h: int,
) -> tuple[str, float]:
    """Return (kind, confidence)."""
    x, y, w, h = bbox
    aspect = _aspect_ratio(bbox)
    edge = _sobel_edge_density(arr, bbox)
    var = _color_variance(arr, bbox)
    rel_h = h / float(canvas_h)

    # Text heuristic: low height relative to canvas, wide aspect, lots of edges.
    if rel_h < 0.10 and aspect > 1.6 and edge > 6.0:
        return KIND_TEXT, 0.7 + min(0.25, edge / 80.0)

    # Portrait photo: tall, large, moderate-to-high variance, lower edge density
    if aspect < 0.95 and rel_h > 0.18 and var > 20.0:
        return KIND_IMAGE_PORTRAIT, 0.78

    # Generic photo-like: large, high variance
    if rel_h > 0.18 and var > 18.0:
        return KIND_IMAGE, 0.7

    # Object/product mockup: medium size, isolated, moderate variance
    if 0.05 < rel_h < 0.22 and aspect > 0.5 and aspect < 1.8 and var > 12.0:
        return KIND_IMAGE_OBJECT, 0.6

    # Short edge-heavy strip = small text / label
    if rel_h < 0.06 and edge > 4.0:
        return KIND_TEXT, 0.55

    return KIND_SHAPE, 0.4


def _font_size_estimate(bbox_height_px: int, canvas_height_px: int) -> tuple[int, str]:
    """Bucket a text-region height into a typical font size + weight class."""
    # heuristic: text region height ~= 1.25 * caps height; scale to 1080 canvas
    norm_h = bbox_height_px / max(1, canvas_height_px) * 1080.0
    if norm_h >= 140:
        return int(round(norm_h * 0.72)), "display"
    if norm_h >= 80:
        return int(round(norm_h * 0.78)), "headline"
    if norm_h >= 45:
        return int(round(norm_h * 0.82)), "subheadline"
    if norm_h >= 25:
        return int(round(norm_h * 0.85)), "body"
    return max(14, int(round(norm_h * 0.9))), "caption"


# --------------------------------------------------------------------------- #
# Layout heuristic.
# --------------------------------------------------------------------------- #

def _layout_heuristic(regions: list[dict], canvas_w: int) -> str:
    if not regions:
        return "empty"
    if len(regions) == 1:
        return "single_hero"

    # group by horizontal position
    centres_x = [r["bbox"][0] + r["bbox"][2] / 2 for r in regions]
    centres_x_norm = [c / canvas_w for c in centres_x]

    # 2-column detection: significant cluster at <0.4 and another at >0.6
    left = sum(1 for c in centres_x_norm if c < 0.42)
    right = sum(1 for c in centres_x_norm if c > 0.58)
    middle = len(centres_x_norm) - left - right
    if left >= 1 and right >= 1 and middle <= max(left, right):
        return "split"

    # do regions stack with consistent widths?
    widths = [r["bbox"][2] / canvas_w for r in regions]
    median_w = sorted(widths)[len(widths) // 2]
    similar = sum(1 for w in widths if abs(w - median_w) < 0.18)
    if similar >= max(2, int(len(widths) * 0.6)):
        # check for overlap in y
        ys_sorted = sorted(regions, key=lambda r: r["bbox"][1])
        overlap = False
        for a, b in zip(ys_sorted, ys_sorted[1:]):
            if a["bbox"][1] + a["bbox"][3] > b["bbox"][1] + 4:
                overlap = True
                break
        return "vertical_stacked_with_overlap" if overlap else "vertical_stacked"

    # hero + caption: one large image at top, smaller things below
    by_area = sorted(regions, key=lambda r: r["bbox"][2] * r["bbox"][3], reverse=True)
    hero = by_area[0]
    rest_above = sum(
        1
        for r in regions
        if r is not hero
        and r["bbox"][1] + r["bbox"][3] <= hero["bbox"][1] + hero["bbox"][3]
    )
    if rest_above <= 1 and any(r is not hero for r in regions):
        return "hero_caption"

    # grid: many regions, multiple per row
    if len(regions) >= 4:
        return "grid_or_multi_row"

    return "mixed"


def _spacing_grid(regions: list[dict], canvas_h: int) -> int:
    """Estimate the spacing grid by looking at top/bottom y values."""
    if len(regions) < 2:
        return 8
    ys: list[int] = []
    for r in regions:
        x, y, w, h = r["bbox"]
        ys.extend([y, y + h])
    # normalize to a 1080-canvas reference height so the grid value is portable
    scale = 1080.0 / max(1, canvas_h)
    ys_norm = sorted({int(round(v * scale)) for v in ys})
    if len(ys_norm) < 2:
        return 8
    diffs = [ys_norm[i + 1] - ys_norm[i] for i in range(len(ys_norm) - 1)]
    diffs = [d for d in diffs if d >= 4]
    if not diffs:
        return 8
    # try common grid sizes; pick the one that explains the most diffs
    candidates = [4, 6, 8, 10, 12, 16]
    best = 8
    best_score = -1.0
    for g in candidates:
        score = sum(1 for d in diffs if abs(d - round(d / g) * g) <= 2)
        if score > best_score:
            best_score = score
            best = g
    return best


def _typography_pairing_guess(regions: list[dict]) -> str:
    text_regions = [r for r in regions if r.get("kind") == KIND_TEXT]
    if not text_regions:
        return "unknown"
    weights = {r.get("estimated_weight", "body") for r in text_regions}
    has_display = any(w in {"display", "headline"} for w in weights)
    has_body = any(w in {"body", "caption", "subheadline"} for w in weights)
    if has_display and has_body:
        return "serif_display + sans_body"
    if has_display:
        return "display_only"
    return "single_sans_stack"


# --------------------------------------------------------------------------- #
# Region naming (semantic IDs).
# --------------------------------------------------------------------------- #

def _assign_region_ids(regions: list[dict], canvas_w: int, canvas_h: int) -> list[dict]:
    """Assign human-friendly ids based on position and kind."""
    counters: Counter[str] = Counter()
    out: list[dict] = []
    sorted_regions = sorted(regions, key=lambda r: (r["bbox"][1], r["bbox"][0]))
    for r in sorted_regions:
        x, y, w, h = r["bbox"]
        kind = r["kind"]
        cy = y + h / 2
        rel_y = cy / canvas_h
        zone = "header" if rel_y < 0.22 else ("body" if rel_y < 0.78 else "footer")
        if kind in (KIND_IMAGE_PORTRAIT, KIND_IMAGE):
            base = f"{zone}_photo" if zone != "body" else "photo_main"
        elif kind == KIND_IMAGE_OBJECT:
            base = f"{zone}_object" if zone != "body" else "product_mockup"
        elif kind == KIND_TEXT:
            weight = r.get("estimated_weight", "body")
            if weight in {"display", "headline"}:
                base = "title"
            elif weight == "subheadline":
                base = "subtitle"
            elif weight == "caption":
                base = f"{zone}_caption"
            else:
                base = "body_text"
        else:
            base = f"{zone}_shape"
        counters[base] += 1
        rid = base if counters[base] == 1 else f"{base}_{counters[base]}"
        r["id"] = rid
        out.append(r)
    return out


# --------------------------------------------------------------------------- #
# Top-level analyzer.
# --------------------------------------------------------------------------- #

def analyze_reference(source: ImageSource) -> dict[str, Any]:
    """Full design-DNA report for a reference image.

    Returns palette, layout regions and typography hints for the image.
    """
    img = _load_image(source)
    orig_w, orig_h = img.size
    work = _resize_for_processing(img)
    work_arr = np.asarray(work, dtype=np.uint8)
    work_w = work_arr.shape[1]
    work_h = work_arr.shape[0]
    scale_x = orig_w / float(work_w)
    scale_y = orig_h / float(work_h)

    # Background detection.
    bg_rgb = _detect_background(work_arr)

    # Foreground mask + morphological close so text glyphs merge into words.
    fg = _foreground_mask(work_arr, bg_rgb)
    fg = _morph_close(fg, radius=2)

    # Horizontal-strip pre-pass to avoid joining vertically-stacked sections.
    bands = _horizontal_strip_bands(fg, min_gap_rows=max(6, int(work_h * 0.012)))

    # Connected components within each band.
    min_raw = max(40, int(work_w * work_h * MIN_RAW_BLOB_FRAC))
    raw_blobs: list[tuple[int, int, int, int, int]] = []
    if bands:
        for y0, y1 in bands:
            sub = fg[y0:y1]
            if sub.size == 0:
                continue
            sub_blobs = _connected_components(sub)
            for x, y, w, h, area in sub_blobs:
                if area < min_raw:
                    continue
                raw_blobs.append((x, y + y0, w, h, area))
    else:
        raw_blobs = [b for b in _connected_components(fg) if b[4] >= min_raw]

    # Ignore blobs that fill nearly the entire canvas (frame artefacts).
    raw_blobs = [
        b
        for b in raw_blobs
        if not (b[2] >= work_w * 0.97 and b[3] >= work_h * 0.97)
    ]
    # Merge per-glyph blobs into lines / word groups.
    blobs = _merge_overlapping_horizontal_blobs(raw_blobs, work_w, work_h)
    # Final size threshold on merged groups (allow elongated thin strips by
    # checking bbox area in addition to filled area).
    min_merged = max(120, int(work_w * work_h * MIN_MERGED_BLOB_FRAC))
    blobs = [b for b in blobs if b[4] >= min_merged or (b[2] * b[3]) >= min_merged * 2]

    # Classify each surviving blob.
    regions: list[dict] = []
    for x, y, w, h, area in blobs:
        kind, conf = _classify_region(work_arr, (x, y, w, h), work_h)
        entry: dict[str, Any] = {
            "bbox_work": [x, y, w, h],
            "bbox": [
                int(round(x * scale_x)),
                int(round(y * scale_y)),
                int(round(w * scale_x)),
                int(round(h * scale_y)),
            ],
            "kind": kind,
            "confidence": round(conf, 3),
            "area_px": int(round(area * scale_x * scale_y)),
        }
        if kind == KIND_TEXT:
            font_px, weight = _font_size_estimate(int(round(h * scale_y)), orig_h)
            entry["estimated_font_size"] = font_px
            entry["estimated_weight"] = weight
        if kind in (KIND_IMAGE_PORTRAIT, KIND_IMAGE, KIND_IMAGE_OBJECT):
            entry["aspect"] = round(_aspect_ratio((x, y, w, h)), 3)
        regions.append(entry)

    regions = _assign_region_ids(regions, orig_w, orig_h)
    regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))

    # Palette.
    palette = extract_palette(img, k=5)

    # Layout & spacing.
    layout = _layout_heuristic(regions, orig_w)
    grid = _spacing_grid(regions, orig_h)
    pairing = _typography_pairing_guess(regions)
    color_logic = _classify_color_logic(palette)

    report: dict[str, Any] = {
        "canvas": {"width": orig_w, "height": orig_h, "aspect": round(orig_w / max(1, orig_h), 3)},
        "background_color": _rgb_to_hex(bg_rgb),
        "palette": [
            {"hex": p["hex"], "share": p["share"], "role": p.get("role", "accent")}
            for p in palette
        ],
        "regions": regions,
        "layout_heuristic": layout,
        "spacing_grid": grid,
        "color_logic": color_logic,
        "typography_pairing_guess": pairing,
        "_meta": {
            "working_resolution": [work_w, work_h],
            "min_blob_px": min_merged,
            "min_raw_blob_px": min_raw,
            "bg_tolerance": BG_TOLERANCE,
        },
    }
    return report


# --------------------------------------------------------------------------- #
# Layout comparison.
# --------------------------------------------------------------------------- #

def _doc_node_bboxes(doc: dict) -> list[dict]:
    """Best-effort extraction of (id, bbox) from an pinsela_native_v1 doc."""
    nodes_out: list[dict] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            geom = node.get("geometry") or node.get("frame") or node.get("rect")
            if isinstance(geom, dict):
                x = geom.get("x", geom.get("left"))
                y = geom.get("y", geom.get("top"))
                w = geom.get("width", geom.get("w"))
                h = geom.get("height", geom.get("h"))
                if all(isinstance(v, (int, float)) for v in (x, y, w, h)):
                    nodes_out.append(
                        {
                            "id": node.get("id") or node.get("name") or "(unnamed)",
                            "kind": node.get("kind") or node.get("type") or "unknown",
                            "bbox": [int(x), int(y), int(w), int(h)],
                        }
                    )
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(doc)
    return nodes_out


def _iou(a: list[int], b: list[int]) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def compare_layouts(ref_source: ImageSource, candidate_doc: dict) -> dict[str, Any]:
    """Compare a reference image's analyzed regions vs a candidate doc's nodes."""
    analysis = analyze_reference(ref_source)
    ref_canvas = analysis["canvas"]
    doc_nodes = _doc_node_bboxes(candidate_doc)

    # Try to normalise candidate doc to reference canvas size.
    doc_canvas = None
    if isinstance(candidate_doc, dict):
        canvas = candidate_doc.get("canvas") or candidate_doc.get("size") or {}
        if isinstance(canvas, dict):
            cw = canvas.get("width") or canvas.get("w")
            ch = canvas.get("height") or canvas.get("h")
            if cw and ch:
                doc_canvas = (int(cw), int(ch))

    sx = sy = 1.0
    if doc_canvas:
        sx = ref_canvas["width"] / doc_canvas[0]
        sy = ref_canvas["height"] / doc_canvas[1]

    scaled_nodes = [
        {
            **n,
            "bbox_scaled": [
                int(round(n["bbox"][0] * sx)),
                int(round(n["bbox"][1] * sy)),
                int(round(n["bbox"][2] * sx)),
                int(round(n["bbox"][3] * sy)),
            ],
        }
        for n in doc_nodes
    ]

    matches: list[dict] = []
    used_nodes: set[int] = set()
    for region in analysis["regions"]:
        best = None
        best_iou = 0.0
        best_idx = -1
        for idx, node in enumerate(scaled_nodes):
            if idx in used_nodes:
                continue
            iou = _iou(region["bbox"], node["bbox_scaled"])
            if iou > best_iou:
                best_iou = iou
                best = node
                best_idx = idx
        if best is not None and best_iou > 0.1:
            used_nodes.add(best_idx)
            rx, ry, rw, rh = region["bbox"]
            nx, ny, nw, nh = best["bbox_scaled"]
            matches.append(
                {
                    "region_id": region["id"],
                    "region_bbox": region["bbox"],
                    "node_id": best["id"],
                    "node_bbox": best["bbox_scaled"],
                    "iou": round(best_iou, 3),
                    "delta_x": nx - rx,
                    "delta_y": ny - ry,
                    "delta_w": nw - rw,
                    "delta_h": nh - rh,
                }
            )
        else:
            matches.append(
                {
                    "region_id": region["id"],
                    "region_bbox": region["bbox"],
                    "node_id": None,
                    "iou": 0.0,
                    "note": "no_candidate_node_overlaps",
                }
            )

    extras = [
        scaled_nodes[i]
        for i in range(len(scaled_nodes))
        if i not in used_nodes
    ]

    return {
        "reference": {
            "canvas": ref_canvas,
            "background_color": analysis["background_color"],
            "layout_heuristic": analysis["layout_heuristic"],
        },
        "matches": matches,
        "unmatched_nodes": [
            {"id": n["id"], "bbox_scaled": n["bbox_scaled"], "kind": n["kind"]}
            for n in extras
        ],
        "score": round(
            sum(m["iou"] for m in matches) / max(1, len(analysis["regions"])),
            3,
        ),
    }


# --------------------------------------------------------------------------- #
# Visualization.
# --------------------------------------------------------------------------- #

_BBOX_COLORS = {
    KIND_TEXT: (255, 80, 80),
    KIND_IMAGE: (60, 140, 240),
    KIND_IMAGE_PORTRAIT: (40, 200, 120),
    KIND_IMAGE_OBJECT: (250, 180, 40),
    KIND_SHAPE: (160, 100, 220),
}


def render_overlay(source: ImageSource, analysis: dict, output_path: str | Path) -> Path:
    """Save a copy of the reference with region bboxes + labels drawn on top."""
    img = _load_image(source).copy()
    draw = ImageDraw.Draw(img, "RGBA")
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size=max(14, img.height // 60))
    except OSError:
        font = ImageFont.load_default()
    for region in analysis.get("regions", []):
        x, y, w, h = region["bbox"]
        color = _BBOX_COLORS.get(region["kind"], (200, 200, 200))
        stroke = max(2, img.width // 400)
        draw.rectangle((x, y, x + w, y + h), outline=color + (255,), width=stroke)
        label = f"{region['id']} [{region['kind']}]"
        if "estimated_font_size" in region:
            label += f" ~{region['estimated_font_size']}px"
        ty = max(0, y - max(20, img.height // 70))
        draw.rectangle((x, ty, x + max(280, len(label) * 9), ty + max(18, img.height // 75)), fill=color + (220,))
        draw.text((x + 4, ty + 1), label, fill=(255, 255, 255, 255), font=font)
    # palette swatches at top-left
    palette = analysis.get("palette", [])
    sw = max(40, img.width // 20)
    for i, p in enumerate(palette):
        rgb = _hex_to_rgb(p["hex"])
        draw.rectangle((10 + i * (sw + 4), 10, 10 + i * (sw + 4) + sw, 10 + sw), fill=rgb + (255,))
        draw.text((10 + i * (sw + 4) + 4, 14 + sw), f"{p['hex']}\n{int(p['share']*100)}%", fill=(0, 0, 0), font=font)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out


__all__ = [
    "analyze_reference",
    "extract_palette",
    "compare_layouts",
    "render_overlay",
    "load_image_from_request",
]
