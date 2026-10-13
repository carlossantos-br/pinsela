"""Pillow-based gradient generator for the macro preprocessor.

Generates PNG bytes for linear/radial gradients. Cached by SHA256 of the
gradient parameters. Numpy-free — uses plain Python loops with Pillow
``Image.new`` + per-row composition (one ImageDraw line per row), which is
fast enough for typical canvas sizes (<= 4096px).

Both functions support transparency: pass ``transparent=True`` to make the
*background* outside the gradient stops fully alpha-zero, useful for
"gradient without a backdrop" (gradient overlays without an opaque backdrop).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

from PIL import Image, ImageDraw

from pinsela.config import default_data_root


# --------------------------------------------------------------------------- #
# Color helpers (independent of the renderer so this stays cache-pure).
# --------------------------------------------------------------------------- #

_CSS_RGB_RE = re.compile(r"^rgba?\(([^)]+)\)$", re.IGNORECASE)


def _clamp_byte(value: float) -> int:
    return max(0, min(255, int(round(value))))


def _parse_color(value) -> Tuple[int, int, int, int]:
    """Parse "#RRGGBB", "#RRGGBBAA", "rgba(...)" or [r,g,b(,a)] into RGBA."""
    if isinstance(value, (list, tuple)):
        parts = list(value)
        if len(parts) >= 3:
            r = _clamp_byte(float(parts[0]))
            g = _clamp_byte(float(parts[1]))
            b = _clamp_byte(float(parts[2]))
            a = _clamp_byte(float(parts[3])) if len(parts) >= 4 else 255
            return (r, g, b, a)
        return (0, 0, 0, 255)

    if isinstance(value, str):
        s = value.strip()
        low = s.lower()
        if low in {"transparent", "none"}:
            return (0, 0, 0, 0)
        if s.startswith("#"):
            s = s[1:]
            if len(s) == 3:
                s = "".join(ch * 2 for ch in s)
            if len(s) == 6:
                try:
                    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)
                except Exception:
                    return (0, 0, 0, 255)
            if len(s) == 8:
                try:
                    return (
                        int(s[0:2], 16),
                        int(s[2:4], 16),
                        int(s[4:6], 16),
                        int(s[6:8], 16),
                    )
                except Exception:
                    return (0, 0, 0, 255)
        m = _CSS_RGB_RE.match(s)
        if m:
            raw = m.group(1).replace("/", ",")
            parts = [p.strip() for p in re.split(r"[,\s]+", raw) if p.strip()]
            if len(parts) >= 3:
                def _ch(t: str) -> float:
                    if t.endswith("%"):
                        return float(t[:-1]) / 100.0 * 255.0
                    return float(t)

                try:
                    r = _clamp_byte(_ch(parts[0]))
                    g = _clamp_byte(_ch(parts[1]))
                    b = _clamp_byte(_ch(parts[2]))
                    a = 255
                    if len(parts) >= 4:
                        af = float(parts[3])
                        if af <= 1.0:
                            a = _clamp_byte(af * 255.0)
                        else:
                            a = _clamp_byte(af)
                    return (r, g, b, a)
                except Exception:
                    return (0, 0, 0, 255)

    if isinstance(value, dict):
        if "color" in value:
            return _parse_color(value.get("color"))

    return (0, 0, 0, 255)


def _normalize_stops(
    stops: Sequence,
) -> List[Tuple[float, Tuple[int, int, int, int]]]:
    """Accepts stops as [(offset, color), ...] or [{"offset":..,"color":..}, ...]."""
    out: List[Tuple[float, Tuple[int, int, int, int]]] = []
    for raw in stops or []:
        if isinstance(raw, dict):
            offset = float(raw.get("offset", 0.0))
            color = _parse_color(raw.get("color"))
        elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
            offset = float(raw[0])
            color = _parse_color(raw[1])
        else:
            continue
        offset = max(0.0, min(1.0, offset))
        out.append((offset, color))
    if not out:
        out = [(0.0, (0, 0, 0, 255)), (1.0, (255, 255, 255, 255))]
    out.sort(key=lambda x: x[0])
    if out[0][0] > 0.0:
        out.insert(0, (0.0, out[0][1]))
    if out[-1][0] < 1.0:
        out.append((1.0, out[-1][1]))
    return out


def _lerp_rgba(
    a: Tuple[int, int, int, int], b: Tuple[int, int, int, int], t: float
) -> Tuple[int, int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(round(a[0] + (b[0] - a[0]) * t)),
        int(round(a[1] + (b[1] - a[1]) * t)),
        int(round(a[2] + (b[2] - a[2]) * t)),
        int(round(a[3] + (b[3] - a[3]) * t)),
    )


def _sample(
    stops: List[Tuple[float, Tuple[int, int, int, int]]], t: float
) -> Tuple[int, int, int, int]:
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        s0, c0 = stops[i]
        s1, c1 = stops[i + 1]
        if s0 <= t <= s1:
            span = s1 - s0
            local = 0.0 if span <= 0 else (t - s0) / span
            return _lerp_rgba(c0, c1, local)
    return stops[-1][1]


# --------------------------------------------------------------------------- #
# Cache path resolution.
# --------------------------------------------------------------------------- #

DEFAULT_CACHE_DIR = default_data_root() / "generated"


def _cache_key(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:32]


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- #
# Public API.
# --------------------------------------------------------------------------- #


def render_linear_gradient(
    width: int,
    height: int,
    angle_deg: float,
    stops: Sequence,
    *,
    transparent: bool = False,
) -> bytes:
    """Return PNG bytes for a linear gradient.

    angle_deg: 0 = left-to-right; 90 = top-to-bottom; 45 = diagonal.
    transparent: when True, output uses alpha; otherwise opaque RGBA at 255.
    """
    w = max(1, int(width))
    h = max(1, int(height))
    norm = _normalize_stops(stops)

    # Project each pixel onto the gradient axis. To minimise per-pixel work,
    # we precompute the projection coefficients and walk row by row.
    angle = math.radians(angle_deg)
    dx = math.cos(angle)
    dy = math.sin(angle)

    # Normalise so t in [0, 1] spans the bounding box of the canvas.
    # Project the four corners onto the axis to find min/max.
    corners = [(0, 0), (w, 0), (0, h), (w, h)]
    projs = [cx * dx + cy * dy for cx, cy in corners]
    p_min = min(projs)
    p_max = max(projs)
    span = max(1e-6, p_max - p_min)

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()

    # Per-row optimisation: t depends linearly on (x, y); precompute x term and
    # add the y term per row.
    for y in range(h):
        ybase = (y * dy - p_min) / span
        xstep = dx / span
        for x in range(w):
            t = ybase + x * xstep
            r, g, bl, a = _sample(norm, max(0.0, min(1.0, t)))
            if not transparent:
                a = 255 if a == 0 else a
            px[x, y] = (r, g, bl, a)

    return _png_bytes(img)


def render_radial_gradient(
    width: int,
    height: int,
    center: Tuple[float, float] | None,
    radius: float | None,
    stops: Sequence,
    *,
    transparent: bool = False,
) -> bytes:
    """Return PNG bytes for a radial gradient centred at ``center``.

    center: (cx, cy) in pixels. None → centre of the canvas.
    radius: max radius for t=1.0. None → half the diagonal.
    transparent: pixels beyond t=1 keep alpha=0 if last stop has alpha=0.
    """
    w = max(1, int(width))
    h = max(1, int(height))
    norm = _normalize_stops(stops)
    cx, cy = center if center is not None else (w / 2.0, h / 2.0)
    if radius is None or radius <= 0:
        radius = math.hypot(w, h) / 2.0

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()

    inv_r = 1.0 / max(1e-6, radius)
    for y in range(h):
        dy2 = (y - cy) ** 2
        for x in range(w):
            d = math.sqrt((x - cx) ** 2 + dy2)
            t = d * inv_r
            r, g, bl, a = _sample(norm, max(0.0, min(1.0, t)))
            if not transparent and a == 0:
                a = 255
            px[x, y] = (r, g, bl, a)

    return _png_bytes(img)


def _png_bytes(img: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def _apply_noise(img: "Image.Image", noise: float, *, seed: int = 0) -> "Image.Image":
    """Overlay subtle deterministic noise on an RGBA image.

    ``noise`` is 0..1 — controls amplitude of per-pixel luma jitter.
    Useful to add a metallic / brushed feel on top of a flat gradient.
    The noise is applied multiplicatively against luma so dark areas
    stay darker (no banding).
    """
    if noise <= 0:
        return img
    amp = max(0.0, min(1.0, float(noise)))
    # Magnitude: noise=1.0 → ±32 luma steps; noise=0.1 → ±3 steps.
    span = int(round(32 * amp))
    if span <= 0:
        return img
    import random as _rnd

    rng = _rnd.Random(seed if seed else 0xC0DE)
    w, h = img.size
    px = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            jitter = rng.randint(-span, span)
            nr = max(0, min(255, r + jitter))
            ng = max(0, min(255, g + jitter))
            nb = max(0, min(255, b + jitter))
            px[x, y] = (nr, ng, nb, a)
    return img


def render_gradient_to_file(
    *,
    width: int,
    height: int,
    gradient_type: str = "linear",
    angle: float = 0.0,
    center: Tuple[float, float] | None = None,
    radius: float | None = None,
    stops: Sequence,
    transparent: bool = False,
    noise: float = 0.0,
    cache_dir: Path | None = None,
) -> Tuple[Path, bytes]:
    """Render and persist a gradient. Cached by SHA256 of params.

    Returns (path, png_bytes). Subsequent calls with the same params hit the
    on-disk cache and skip rendering.

    ``noise`` (0..1) overlays subtle per-pixel luma jitter — gives metallic /
    brushed feel without banding. 0 disables.
    """
    cache_dir = cache_dir or DEFAULT_CACHE_DIR
    _ensure_dir(cache_dir)

    # Normalise stops payload for cache key.
    normalised = []
    for s in _normalize_stops(stops):
        offset, (r, g, b, a) = s
        normalised.append([round(offset, 6), [r, g, b, a]])

    key_payload = {
        "type": gradient_type,
        "w": int(width),
        "h": int(height),
        "angle": round(float(angle), 4),
        "center": list(center) if center else None,
        "radius": round(float(radius), 4) if radius else None,
        "stops": normalised,
        "transparent": bool(transparent),
        "noise": round(float(noise), 4),
        "v": 2,
    }
    key = _cache_key(key_payload)
    path = cache_dir / f"gradient_{key}.png"

    if path.exists() and path.stat().st_size > 0:
        try:
            return path, path.read_bytes()
        except Exception:
            pass

    if gradient_type == "radial":
        data = render_radial_gradient(
            width, height, center, radius, stops, transparent=transparent
        )
    else:
        data = render_linear_gradient(
            width, height, angle, stops, transparent=transparent
        )

    if noise and noise > 0:
        import io as _io

        img = Image.open(_io.BytesIO(data)).convert("RGBA")
        seed = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
        img = _apply_noise(img, noise, seed=seed)
        data = _png_bytes(img)

    try:
        path.write_bytes(data)
    except Exception:
        # Best effort cache; still return the bytes.
        pass
    return path, data
