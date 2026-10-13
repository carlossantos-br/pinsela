"""Real linear/radial gradient renderer for the native engine.

Supported `fill` shapes::

    {
        "type": "linear" | "radial",
        "angle": 90.0,                  # linear only; degrees, 0 = left->right
        "stops": [
            { "offset": 0.0, "color": "#ff0000", "opacity": 1.0 },
            { "offset": 1.0, "color": "#0000ff", "opacity": 1.0 },
        ],
        # radial only:
        "center": [0.5, 0.5],           # 0..1 normalized
        "radius": 0.5,                  # 0..1 of half-min-dim
    }

We accept variations: gradient/linear-gradient/radial-gradient type
names; `from`/`to` aliases for stop offsets; nested `color` dicts.
"""

from __future__ import annotations

import math
from typing import Any

from PIL import Image


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _coerce_rgba(v: Any, default: tuple[int, int, int, int] = (0, 0, 0, 255)) -> tuple[int, int, int, int]:
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        r, g, b = int(v[0]), int(v[1]), int(v[2])
        a = int(v[3]) if len(v) >= 4 else 255
        return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), max(0, min(255, a)))
    if isinstance(v, str):
        s = v.strip()
        if s.startswith("#"):
            s = s[1:]
            try:
                if len(s) == 3:
                    s = "".join(ch * 2 for ch in s)
                if len(s) == 6:
                    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)
                if len(s) == 8:
                    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16))
            except Exception:
                return default
    if isinstance(v, dict):
        if "color" in v:
            return _coerce_rgba(v.get("color"), default=default)
        if all(k in v for k in ("r", "g", "b")):
            r = _f(v.get("r"), 0)
            g = _f(v.get("g"), 0)
            b = _f(v.get("b"), 0)
            a = _f(v.get("a"), 1.0)
            if max(r, g, b) <= 1.0:
                return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)), int(round(min(1.0, a) * 255)))
            return (int(r), int(g), int(b), int(min(255, a * 255 if a <= 1 else a)))
    return default


def is_gradient_fill(fill: Any) -> bool:
    if not isinstance(fill, dict):
        return False
    t = str(fill.get("type") or fill.get("kind") or "").strip().lower()
    if t in {"linear", "radial", "linear-gradient", "radial-gradient", "gradient"}:
        return True
    # also accept presence of `stops`
    stops = fill.get("stops")
    return isinstance(stops, list) and len(stops) >= 2


def _normalize_stops(raw: Any) -> list[tuple[float, tuple[int, int, int, int]]]:
    out: list[tuple[float, tuple[int, int, int, int]]] = []
    if not isinstance(raw, list):
        return out
    for stop in raw:
        if not isinstance(stop, dict):
            continue
        offset = _f(stop.get("offset", stop.get("position", stop.get("at"))), -1.0)
        if offset < 0:
            continue
        # offset may come in 0..100
        if offset > 1.0:
            offset = offset / 100.0
        offset = max(0.0, min(1.0, offset))
        color = _coerce_rgba(stop.get("color") or stop, default=(0, 0, 0, 255))
        opacity = _f(stop.get("opacity"), 1.0)
        if opacity > 1.0:
            opacity = opacity / 100.0
        opacity = max(0.0, min(1.0, opacity))
        final_a = int(round(color[3] * opacity))
        out.append((offset, (color[0], color[1], color[2], final_a)))
    if not out:
        return out
    out.sort(key=lambda s: s[0])
    # ensure 0 and 1 endpoints exist (extend with first/last color)
    if out[0][0] > 0.0:
        out.insert(0, (0.0, out[0][1]))
    if out[-1][0] < 1.0:
        out.append((1.0, out[-1][1]))
    return out


def _sample(stops: list[tuple[float, tuple[int, int, int, int]]], t: float) -> tuple[int, int, int, int]:
    t = max(0.0, min(1.0, t))
    # binary scan
    for i in range(len(stops) - 1):
        a_off, a_col = stops[i]
        b_off, b_col = stops[i + 1]
        if t <= b_off:
            span = b_off - a_off
            if span <= 1e-6:
                return b_col
            k = (t - a_off) / span
            return (
                int(round(a_col[0] + (b_col[0] - a_col[0]) * k)),
                int(round(a_col[1] + (b_col[1] - a_col[1]) * k)),
                int(round(a_col[2] + (b_col[2] - a_col[2]) * k)),
                int(round(a_col[3] + (b_col[3] - a_col[3]) * k)),
            )
    return stops[-1][1]


def render_gradient_image(fill: dict[str, Any], size: tuple[int, int]) -> Image.Image:
    """Return an RGBA image of `size` filled with the requested gradient.

    Falls back to a transparent layer if `fill` is malformed.
    """
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    stops = _normalize_stops(fill.get("stops"))
    if len(stops) < 2:
        return img

    raw_type = str(fill.get("type") or fill.get("kind") or "linear").strip().lower()
    if raw_type in {"linear-gradient", "gradient"}:
        raw_type = "linear"
    elif raw_type == "radial-gradient":
        raw_type = "radial"

    pixels = img.load()

    if raw_type == "radial":
        center_raw = fill.get("center")
        if isinstance(center_raw, (list, tuple)) and len(center_raw) >= 2:
            cx_n = _f(center_raw[0], 0.5)
            cy_n = _f(center_raw[1], 0.5)
        else:
            cx_n = _f(fill.get("cx"), 0.5)
            cy_n = _f(fill.get("cy"), 0.5)
        radius_n = _f(fill.get("radius"), 0.5)
        cx = cx_n * w
        cy = cy_n * h
        max_dim = math.hypot(max(cx, w - cx), max(cy, h - cy))
        radius_px = max(1.0, radius_n * max_dim if radius_n <= 1.0 else radius_n)
        for y in range(h):
            for x in range(w):
                d = math.hypot(x - cx, y - cy) / radius_px
                pixels[x, y] = _sample(stops, d)
    else:
        # linear: 0 deg = left-to-right (per usual Figma convention)
        angle = _f(fill.get("angle"), 90.0)
        # Convert: angle 0 -> direction (1, 0); 90 -> (0, 1) (top->bottom).
        a = math.radians(angle)
        dx = math.cos(a)
        dy = math.sin(a)
        # project (x, y) onto direction normalized to bounds.
        # Compute max projection length: corners
        corners = [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)]
        projs = [px * dx + py * dy for px, py in corners]
        p_min = min(projs)
        p_max = max(projs)
        span = max(1e-6, p_max - p_min)
        for y in range(h):
            for x in range(w):
                p = (x * dx + y * dy - p_min) / span
                pixels[x, y] = _sample(stops, p)

    return img
