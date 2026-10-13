"""Image fade-to-transparent — multiplies an image's alpha by a fade mask.

Non-destructive companion to the editor's "Fade" edit op. The fade spec lives
on the node at ``style.image_fade`` and is applied at render time (here for the
Python export renderer; the editor canvas mirrors the same math live).

Spec shape (all parts optional; absent/`enabled:false` = image untouched):

    style.image_fade = {
        "enabled": true,
        "softness": 0.0,            # 0..1 extra easing on every ramp
        "linear":  {"angle": 90, "start": 0.4, "end": 1.0} | null,
        "radial":  {"cx": 0.5, "cy": 0.5, "inner": 0.6, "outer": 1.0} | null,
        "edges":   {"top": 0, "right": 0.3, "bottom": 0, "left": 0},
    }

The final alpha multiplier per pixel is the PRODUCT of every active component
(linear x radial x each edge). 1.0 = fully opaque, 0.0 = fully transparent.

Numpy-free (plain loops + Pillow), matching the style of ``gradient_native``.
The mask is computed over the node's box (the fitted image layer size), so all
fractions are relative to that box.
"""
from __future__ import annotations

import math
from typing import Any

from PIL import Image, ImageChops


def _f(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _smoothstep(t: float) -> float:
    t = _clamp01(t)
    return t * t * (3.0 - 2.0 * t)


def _ease(factor: float, softness: float) -> float:
    """Blend a linear factor toward smoothstep by `softness` (0..1)."""
    factor = _clamp01(factor)
    if softness <= 0.0:
        return factor
    return factor * (1.0 - softness) + _smoothstep(factor) * softness


def has_fade(spec: Any) -> bool:
    """True if the spec asks for any actual fading."""
    if not isinstance(spec, dict):
        return False
    if not bool(spec.get("enabled", True)):
        return False
    if isinstance(spec.get("linear"), dict):
        ln = spec["linear"]
        if _f(ln.get("end"), 1.0) > _f(ln.get("start"), 0.0):
            return True
    if isinstance(spec.get("radial"), dict):
        rd = spec["radial"]
        if _f(rd.get("outer"), 1.0) > _f(rd.get("inner"), 0.0):
            return True
    edges = spec.get("edges")
    if isinstance(edges, dict):
        if any(_f(edges.get(side), 0.0) > 0.0 for side in ("top", "right", "bottom", "left")):
            return True
    return False


def _linear_factor(ln: dict[str, Any], x: float, y: float, w: int, h: int) -> float:
    """1.0 until `start`, ramping to 0.0 at `end`, along `angle` direction."""
    start = _clamp01(_f(ln.get("start"), 0.0))
    end = _clamp01(_f(ln.get("end"), 1.0))
    if end <= start:
        return 1.0
    angle = _f(ln.get("angle"), 90.0)
    a = math.radians(angle)
    dx = math.cos(a)
    dy = math.sin(a)
    # Project pixel onto direction, normalized so the box spans 0..1.
    # Projection range over the box corners:
    proj = (x / max(1, w - 1)) * dx + (y / max(1, h - 1)) * dy
    # Normalize proj from [min(0,dx)+min(0,dy) .. max(0,dx)+max(0,dy)] to 0..1
    lo = min(0.0, dx) + min(0.0, dy)
    hi = max(0.0, dx) + max(0.0, dy)
    span = hi - lo
    t = (proj - lo) / span if span > 1e-6 else 0.0
    if t <= start:
        return 1.0
    if t >= end:
        return 0.0
    return 1.0 - (t - start) / (end - start)


def _radial_factor(rd: dict[str, Any], x: float, y: float, w: int, h: int) -> float:
    """1.0 until `inner` fraction of radius, ramping to 0.0 at `outer`."""
    inner = _clamp01(_f(rd.get("inner"), 0.6))
    outer = _clamp01(_f(rd.get("outer"), 1.0))
    if outer <= inner:
        return 1.0
    cx = _f(rd.get("cx"), 0.5) * w
    cy = _f(rd.get("cy"), 0.5) * h
    max_r = math.hypot(max(cx, w - cx), max(cy, h - cy))
    if max_r <= 1e-6:
        return 1.0
    d = math.hypot(x - cx, y - cy) / max_r
    if d <= inner:
        return 1.0
    if d >= outer:
        return 0.0
    return 1.0 - (d - inner) / (outer - inner)


def _edge_factor(edges: dict[str, Any], x: float, y: float, w: int, h: int) -> float:
    """Product of per-side ramps; each side fades inward over depth*dim."""
    factor = 1.0
    top = _clamp01(_f(edges.get("top"), 0.0))
    if top > 0.0:
        factor *= _clamp01(y / (top * max(1, h - 1)))
    bottom = _clamp01(_f(edges.get("bottom"), 0.0))
    if bottom > 0.0:
        factor *= _clamp01((h - 1 - y) / (bottom * max(1, h - 1)))
    left = _clamp01(_f(edges.get("left"), 0.0))
    if left > 0.0:
        factor *= _clamp01(x / (left * max(1, w - 1)))
    right = _clamp01(_f(edges.get("right"), 0.0))
    if right > 0.0:
        factor *= _clamp01((w - 1 - x) / (right * max(1, w - 1)))
    return factor


def build_alpha_mask(spec: dict[str, Any], size: tuple[int, int]) -> Image.Image:
    """Return an 'L' mask (255=opaque, 0=transparent) for the fade spec."""
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    mask = Image.new("L", (w, h), 255)
    if not has_fade(spec):
        return mask
    softness = _clamp01(_f(spec.get("softness"), 0.0))
    ln = spec.get("linear") if isinstance(spec.get("linear"), dict) else None
    rd = spec.get("radial") if isinstance(spec.get("radial"), dict) else None
    edges = spec.get("edges") if isinstance(spec.get("edges"), dict) else None
    px = mask.load()
    for y in range(h):
        for x in range(w):
            f = 1.0
            if ln is not None:
                f *= _linear_factor(ln, x, y, w, h)
            if rd is not None:
                f *= _radial_factor(rd, x, y, w, h)
            if edges is not None:
                f *= _edge_factor(edges, x, y, w, h)
            f = _ease(f, softness)
            px[x, y] = int(round(_clamp01(f) * 255))
    return mask


def apply_image_fade(img: Image.Image, spec: Any) -> Image.Image:
    """Multiply `img`'s alpha by the fade mask. Returns RGBA. Input untouched."""
    if not has_fade(spec):
        return img
    rgba = img.convert("RGBA")
    mask = build_alpha_mask(spec, rgba.size)
    alpha = rgba.split()[-1]
    rgba.putalpha(ImageChops.multiply(alpha, mask))
    return rgba
