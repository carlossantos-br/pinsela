"""Vector shape primitives (ellipse, polygon, star) for the native renderer.

Returns an RGBA image sized exactly (w, h) with the shape drawn at the
local origin, plus a corresponding alpha mask. The renderer composites
this layer at the node's (x, y).

Public API
==========
- render_shape(shape_type, *, width, height, fill_rgba, stroke=None,
               sides=None, star_points=None, star_inner_ratio=None,
               corner_radius=0.0) -> (Image, Mask)
- shape_mask(shape_type, width, height, **kwargs) -> Image.L
    Returns just the alpha mask, used for shadow silhouettes and clips.
"""

from __future__ import annotations

import math
from typing import Any

from PIL import Image, ImageDraw


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _build_polygon_points(width: float, height: float, sides: int, rotation_deg: float = -90.0) -> list[tuple[float, float]]:
    cx = width / 2.0
    cy = height / 2.0
    rx = width / 2.0
    ry = height / 2.0
    n = max(3, int(sides))
    rot = math.radians(rotation_deg)
    pts: list[tuple[float, float]] = []
    for i in range(n):
        ang = rot + (i * 2.0 * math.pi / n)
        x = cx + rx * math.cos(ang)
        y = cy + ry * math.sin(ang)
        pts.append((x, y))
    return pts


def _build_star_points(
    width: float,
    height: float,
    points: int,
    inner_ratio: float,
    rotation_deg: float = -90.0,
) -> list[tuple[float, float]]:
    cx = width / 2.0
    cy = height / 2.0
    rx_outer = width / 2.0
    ry_outer = height / 2.0
    rx_inner = rx_outer * max(0.05, min(0.95, inner_ratio))
    ry_inner = ry_outer * max(0.05, min(0.95, inner_ratio))
    n = max(3, int(points))
    rot = math.radians(rotation_deg)
    pts: list[tuple[float, float]] = []
    for i in range(n * 2):
        outer = (i % 2) == 0
        rx = rx_outer if outer else rx_inner
        ry = ry_outer if outer else ry_inner
        ang = rot + (i * math.pi / n)
        x = cx + rx * math.cos(ang)
        y = cy + ry * math.sin(ang)
        pts.append((x, y))
    return pts


def _rounded_rect_perimeter(w: float, h: float, r: float, *, samples_per_corner: int = 10) -> list[tuple[float, float]]:
    """Closed polyline tracing a rounded-rectangle outline at local origin."""
    r = max(0.0, min(r, min(w, h) / 2.0))
    if r <= 0.5:
        return [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h), (0.0, 0.0)]
    pts: list[tuple[float, float]] = []
    corners = [
        (r, r, 180.0, 270.0),          # top-left
        (w - r, r, 270.0, 360.0),      # top-right
        (w - r, h - r, 0.0, 90.0),     # bottom-right
        (r, h - r, 90.0, 180.0),       # bottom-left
    ]
    for cx, cy, a0, a1 in corners:
        for i in range(samples_per_corner + 1):
            ang = math.radians(a0 + (a1 - a0) * i / samples_per_corner)
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    pts.append(pts[0])
    return pts


def _ellipse_perimeter(w: float, h: float, *, samples: int = 180) -> list[tuple[float, float]]:
    cx, cy, rx, ry = w / 2.0, h / 2.0, w / 2.0, h / 2.0
    pts = [(cx + rx * math.cos(2 * math.pi * i / samples), cy + ry * math.sin(2 * math.pi * i / samples)) for i in range(samples)]
    pts.append(pts[0])
    return pts


def normalize_dash(dash: Any) -> tuple[float, float] | None:
    """Normalize a dash spec to (on, off) px lengths, or None for solid.

    Accepts [on, off] / [on] list, single number, or "on,off" string.
    """
    if dash is None:
        return None
    on = off = 0.0
    if isinstance(dash, (list, tuple)) and dash:
        on = _f(dash[0], 0.0)
        off = _f(dash[1], on) if len(dash) > 1 else on
    elif isinstance(dash, (int, float)):
        on = off = _f(dash, 0.0)
    elif isinstance(dash, str):
        parts = [p for p in dash.replace(";", ",").split(",") if p.strip()]
        if parts:
            on = _f(parts[0], 0.0)
            off = _f(parts[1], on) if len(parts) > 1 else on
    if on <= 0.0:
        return None
    return (on, off if off > 0.0 else on)


def _outline_points(
    shape_type: str,
    w: int,
    h: int,
    *,
    sides: int | None = None,
    star_points: int | None = None,
    star_inner_ratio: float | None = None,
    corner_radius: float = 0.0,
) -> list[tuple[float, float]]:
    s = str(shape_type or "").strip().lower()
    if s == "ellipse":
        return _ellipse_perimeter(w - 1, h - 1)
    if s == "polygon":
        pts = _build_polygon_points(w, h, sides or 6)
        return pts + [pts[0]]
    if s == "star":
        pts = _build_star_points(w, h, star_points or 5, _f(star_inner_ratio, 0.5))
        return pts + [pts[0]]
    return _rounded_rect_perimeter(w - 1, h - 1, max(0.0, corner_radius))


def _draw_dashed_polyline(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[float, float]],
    *,
    fill: tuple[int, int, int, int],
    width: int,
    dash_on: float,
    dash_off: float,
) -> None:
    """Walk a polyline drawing on/off dash segments of the given lengths."""
    period = dash_on + dash_off
    if period <= 0:
        return
    pos = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        seg_len = math.hypot(x1 - x0, y1 - y0)
        if seg_len <= 0:
            continue
        ux, uy = (x1 - x0) / seg_len, (y1 - y0) / seg_len
        travelled = 0.0
        while travelled < seg_len:
            phase = pos % period
            if phase < dash_on:
                run = min(dash_on - phase, seg_len - travelled)
                sx, sy = x0 + ux * travelled, y0 + uy * travelled
                ex, ey = x0 + ux * (travelled + run), y0 + uy * (travelled + run)
                draw.line((sx, sy, ex, ey), fill=fill, width=width)
            else:
                run = min(period - phase, seg_len - travelled)
            travelled += run
            pos += run


def shape_mask(
    shape_type: str,
    width: float,
    height: float,
    *,
    sides: int | None = None,
    star_points: int | None = None,
    star_inner_ratio: float | None = None,
    corner_radius: float = 0.0,
) -> Image.Image:
    w = max(1, int(round(width)))
    h = max(1, int(round(height)))
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    s = str(shape_type or "").strip().lower()
    if s == "ellipse":
        draw.ellipse((0, 0, w - 1, h - 1), fill=255)
    elif s == "polygon":
        pts = _build_polygon_points(w, h, sides or 6)
        draw.polygon(pts, fill=255)
    elif s == "star":
        pts = _build_star_points(w, h, star_points or 5, _f(star_inner_ratio, 0.5))
        draw.polygon(pts, fill=255)
    else:
        draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=max(0.0, corner_radius), fill=255)
    return mask


def render_shape(
    shape_type: str,
    *,
    width: float,
    height: float,
    fill_rgba: tuple[int, int, int, int] | None,
    fill_image: Image.Image | None = None,
    sides: int | None = None,
    star_points: int | None = None,
    star_inner_ratio: float | None = None,
    corner_radius: float = 0.0,
    stroke_rgba: tuple[int, int, int, int] | None = None,
    stroke_width: float = 0.0,
    stroke_dash: Any = None,
) -> Image.Image:
    """Render `shape_type` to a transparent RGBA layer of (width, height).

    If `fill_image` is provided, it is masked by the shape (used for
    gradient fills). Otherwise `fill_rgba` is used as solid.
    """
    w = max(1, int(round(width)))
    h = max(1, int(round(height)))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    mask = shape_mask(
        shape_type,
        w,
        h,
        sides=sides,
        star_points=star_points,
        star_inner_ratio=star_inner_ratio,
        corner_radius=corner_radius,
    )

    if fill_image is not None:
        fi = fill_image
        if fi.size != (w, h):
            fi = fi.resize((w, h), Image.Resampling.LANCZOS)
        if fi.mode != "RGBA":
            fi = fi.convert("RGBA")
        # multiply mask into fi's alpha
        from PIL import ImageChops

        a = fi.split()[-1]
        fi.putalpha(ImageChops.multiply(a, mask))
        layer.alpha_composite(fi)
    elif fill_rgba is not None and fill_rgba[3] > 0:
        solid = Image.new("RGBA", (w, h), fill_rgba)
        solid.putalpha(mask if fill_rgba[3] == 255 else mask.point(lambda v: int(v * (fill_rgba[3] / 255.0))))
        layer.alpha_composite(solid)

    if stroke_rgba is not None and stroke_rgba[3] > 0 and stroke_width > 0:
        draw = ImageDraw.Draw(layer)
        lw = max(1, int(round(stroke_width)))
        s = str(shape_type or "").strip().lower()
        dash = normalize_dash(stroke_dash)
        if dash is not None:
            pts = _outline_points(
                s, w, h,
                sides=sides, star_points=star_points,
                star_inner_ratio=star_inner_ratio, corner_radius=corner_radius,
            )
            _draw_dashed_polyline(draw, pts, fill=stroke_rgba, width=lw, dash_on=dash[0], dash_off=dash[1])
        elif s == "ellipse":
            draw.ellipse((0, 0, w - 1, h - 1), outline=stroke_rgba, width=lw)
        elif s == "polygon":
            pts = _build_polygon_points(w, h, sides or 6)
            draw.line(pts + [pts[0]], fill=stroke_rgba, width=lw)
        elif s == "star":
            pts = _build_star_points(w, h, star_points or 5, _f(star_inner_ratio, 0.5))
            draw.line(pts + [pts[0]], fill=stroke_rgba, width=lw)
        else:
            draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=max(0.0, corner_radius), outline=stroke_rgba, width=lw)

    return layer
