"""Per-node Pillow effects for the native renderer.

Implements the subset of `style.effects[]` items previously ignored by
the native engine. Each effect operates on an RGBA layer image and
returns either:
  - a *replacement* layer (for layer-level blur, noise) OR
  - a tuple (under_layer, over_layer) where the caller composites
    `under_layer` below the original node and `over_layer` above it
    (for drop_shadow, inner_shadow, glow).

The renderer is expected to:

    base.alpha_composite(under, (ox, oy))
    base.alpha_composite(node_layer, (ox, oy))
    base.alpha_composite(over, (ox, oy))

Public API
==========
- apply_drop_shadow(layer, *, offset_x, offset_y, blur, color, opacity, spread)
- apply_inner_shadow(layer, *, offset_x, offset_y, blur, color, opacity, spread)
- apply_glow(layer, *, blur, color, opacity, spread)
- apply_blur(layer, *, radius)
- apply_noise(layer, *, amount, monochrome)
- render_effects(layer, effects)  -> (under, node, over)
    Convenience: takes the original layer + a list of `style.effects`
    dicts and returns a composited triple ready for paste.

All inputs default to safe no-ops on malformed data.
"""

from __future__ import annotations

import random
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFilter


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _b(v: Any, default: bool = False) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(v, (int, float)):
        return bool(v)
    return default


def _coerce_rgba(v: Any, default: tuple[int, int, int, int] = (0, 0, 0, 255)) -> tuple[int, int, int, int]:
    # Lightweight color coerce — the renderer has a richer one, but we
    # keep this self-contained so effects_engine has no circular import.
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
            return (int(r), int(g), int(b), int(min(255, int(a * 255 if a <= 1 else a))))
    return default


def _expand_canvas(layer: Image.Image, margin: int) -> Image.Image:
    """Pad the layer so blurred halos do not clip at edges."""
    if margin <= 0:
        return layer.copy()
    w, h = layer.size
    new = Image.new("RGBA", (w + margin * 2, h + margin * 2), (0, 0, 0, 0))
    new.alpha_composite(layer, (margin, margin))
    return new


def _silhouette(layer: Image.Image, color: tuple[int, int, int, int]) -> Image.Image:
    """Return an image of `color` masked by `layer`'s alpha."""
    alpha = layer.split()[-1]
    out = Image.new("RGBA", layer.size, (color[0], color[1], color[2], 0))
    # multiply alpha by color's alpha factor
    color_alpha = color[3]
    if color_alpha < 255:
        scaled = alpha.point(lambda v: int(v * (color_alpha / 255.0)))
    else:
        scaled = alpha
    out.putalpha(scaled)
    return out


# ----------------------------------------------------------------------------
# Drop shadow
# ----------------------------------------------------------------------------
def apply_drop_shadow(
    layer: Image.Image,
    *,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    blur: float = 0.0,
    color: Any = (0, 0, 0, 153),
    opacity: float = 1.0,
    spread: float = 0.0,
) -> tuple[Image.Image, tuple[int, int]]:
    """Return (shadow_layer, (paste_dx, paste_dy)) to composite UNDER the node.

    paste deltas are relative to the original node's top-left.
    """
    color_rgba = _coerce_rgba(color, default=(0, 0, 0, 153))
    op = max(0.0, min(1.0, float(opacity)))
    final_a = int(round(color_rgba[3] * op))
    if final_a <= 0:
        # no-op
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0)), (0, 0)
    color_rgba = (color_rgba[0], color_rgba[1], color_rgba[2], final_a)

    blur_radius = max(0.0, float(blur))
    spread_px = int(round(max(0.0, float(spread))))
    margin = int(round(blur_radius * 3.0)) + spread_px + 4

    expanded = _expand_canvas(layer, margin)
    sil = _silhouette(expanded, color_rgba)
    if spread_px > 0:
        # crude spread: grow via maxfilter on alpha
        a = sil.split()[-1]
        size = max(3, spread_px * 2 + 1)
        a = a.filter(ImageFilter.MaxFilter(size if size % 2 == 1 else size + 1))
        sil.putalpha(a)
    if blur_radius > 0:
        sil = sil.filter(ImageFilter.GaussianBlur(blur_radius))

    # The shadow layer is centered on the original node bounds shifted by (offset_x, offset_y).
    paste_dx = int(round(offset_x)) - margin
    paste_dy = int(round(offset_y)) - margin
    return sil, (paste_dx, paste_dy)


# ----------------------------------------------------------------------------
# Inner shadow
# ----------------------------------------------------------------------------
def apply_inner_shadow(
    layer: Image.Image,
    *,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    blur: float = 0.0,
    color: Any = (0, 0, 0, 153),
    opacity: float = 1.0,
    spread: float = 0.0,
) -> tuple[Image.Image, tuple[int, int]]:
    """Return an overlay sized like the layer to composite ABOVE the node."""
    color_rgba = _coerce_rgba(color, default=(0, 0, 0, 153))
    op = max(0.0, min(1.0, float(opacity)))
    final_a = int(round(color_rgba[3] * op))
    if final_a <= 0:
        return Image.new("RGBA", layer.size, (0, 0, 0, 0)), (0, 0)
    color_rgba = (color_rgba[0], color_rgba[1], color_rgba[2], final_a)

    blur_radius = max(0.0, float(blur))
    spread_px = int(round(max(0.0, float(spread))))

    w, h = layer.size
    # Build a "hole" mask: alpha of inverted, offset silhouette.
    inverted = ImageChops.invert(layer.split()[-1])
    # paste inverted shifted by offset into a black canvas
    hole = Image.new("L", (w, h), 0)
    hole.paste(inverted, (int(round(offset_x)), int(round(offset_y))))
    if spread_px > 0:
        size = max(3, spread_px * 2 + 1)
        hole = hole.filter(ImageFilter.MaxFilter(size if size % 2 == 1 else size + 1))
    if blur_radius > 0:
        hole = hole.filter(ImageFilter.GaussianBlur(blur_radius))

    # The shadow only shows INSIDE the node's alpha
    node_alpha = layer.split()[-1]
    final_alpha = ImageChops.multiply(hole, node_alpha)
    final_alpha = final_alpha.point(lambda v: int(v * (final_a / 255.0)))

    over = Image.new("RGBA", (w, h), (color_rgba[0], color_rgba[1], color_rgba[2], 0))
    over.putalpha(final_alpha)
    return over, (0, 0)


# ----------------------------------------------------------------------------
# Glow
# ----------------------------------------------------------------------------
def apply_glow(
    layer: Image.Image,
    *,
    blur: float = 10.0,
    color: Any = (255, 255, 255, 200),
    opacity: float = 1.0,
    spread: float = 0.0,
) -> tuple[Image.Image, tuple[int, int]]:
    """Outer glow — same conceptually as a drop_shadow with zero offset and brighter color."""
    return apply_drop_shadow(
        layer,
        offset_x=0.0,
        offset_y=0.0,
        blur=blur,
        color=color,
        opacity=opacity,
        spread=spread,
    )


# ----------------------------------------------------------------------------
# Layer blur
# ----------------------------------------------------------------------------
def apply_blur(layer: Image.Image, *, radius: float = 4.0) -> Image.Image:
    r = max(0.0, float(radius))
    if r <= 0:
        return layer.copy()
    return layer.filter(ImageFilter.GaussianBlur(r))


# ----------------------------------------------------------------------------
# Noise overlay
# ----------------------------------------------------------------------------
def apply_noise(layer: Image.Image, *, amount: float = 0.15, monochrome: bool = True) -> Image.Image:
    """Overlay procedural noise constrained to the layer's alpha mask."""
    amt = max(0.0, min(1.0, float(amount)))
    if amt <= 0:
        return layer.copy()
    w, h = layer.size
    rng = random.Random(0xE0F11A77)
    if monochrome:
        # Pixel-level noise via raw bytes for speed.
        n_bytes = bytearray(w * h)
        for i in range(len(n_bytes)):
            n_bytes[i] = rng.randint(0, 255)
        noise = Image.frombytes("L", (w, h), bytes(n_bytes))
        noise_rgba = Image.merge("RGBA", (noise, noise, noise, layer.split()[-1].point(lambda v: int(v * amt))))
    else:
        bands = []
        for _ in range(3):
            n_bytes = bytearray(w * h)
            for i in range(len(n_bytes)):
                n_bytes[i] = rng.randint(0, 255)
            bands.append(Image.frombytes("L", (w, h), bytes(n_bytes)))
        bands.append(layer.split()[-1].point(lambda v: int(v * amt)))
        noise_rgba = Image.merge("RGBA", tuple(bands))
    out = layer.copy()
    out.alpha_composite(noise_rgba)
    return out


# ----------------------------------------------------------------------------
# Effects orchestrator
# ----------------------------------------------------------------------------
def render_effects(
    layer: Image.Image, effects: list[dict[str, Any]] | None
) -> tuple[list[tuple[Image.Image, tuple[int, int]]], Image.Image, list[tuple[Image.Image, tuple[int, int]]]]:
    """Compose all effects for a single node.

    Returns (under_layers, replacement_layer, over_layers) where the
    caller pastes under_layers first, then the (possibly mutated)
    replacement_layer, then the over_layers — all positioned relative
    to the same anchor as the original node layer.
    """
    if not effects:
        return [], layer, []

    under: list[tuple[Image.Image, tuple[int, int]]] = []
    over: list[tuple[Image.Image, tuple[int, int]]] = []
    work = layer

    for eff in effects:
        if not isinstance(eff, dict):
            continue
        if not _b(eff.get("enabled", eff.get("visible", True)), True):
            continue
        etype = str(eff.get("type") or eff.get("kind") or "").strip().lower()

        if etype == "drop_shadow":
            shadow, delta = apply_drop_shadow(
                work,
                offset_x=_f(eff.get("offset_x", eff.get("dx")), 0.0),
                offset_y=_f(eff.get("offset_y", eff.get("dy")), 0.0),
                blur=_f(eff.get("blur", eff.get("radius")), 0.0),
                color=eff.get("color"),
                opacity=_f(eff.get("opacity"), 1.0),
                spread=_f(eff.get("spread"), 0.0),
            )
            under.append((shadow, delta))

        elif etype == "inner_shadow":
            shadow, delta = apply_inner_shadow(
                work,
                offset_x=_f(eff.get("offset_x", eff.get("dx")), 0.0),
                offset_y=_f(eff.get("offset_y", eff.get("dy")), 0.0),
                blur=_f(eff.get("blur", eff.get("radius")), 0.0),
                color=eff.get("color"),
                opacity=_f(eff.get("opacity"), 1.0),
                spread=_f(eff.get("spread"), 0.0),
            )
            over.append((shadow, delta))

        elif etype in {"glow", "outer_glow"}:
            glow, delta = apply_glow(
                work,
                blur=_f(eff.get("blur", eff.get("radius")), 10.0),
                color=eff.get("color"),
                opacity=_f(eff.get("opacity"), 1.0),
                spread=_f(eff.get("spread"), 0.0),
            )
            under.append((glow, delta))

        elif etype in {"blur", "layer_blur"}:
            work = apply_blur(work, radius=_f(eff.get("radius", eff.get("blur")), 4.0))

        elif etype == "noise":
            work = apply_noise(
                work,
                amount=_f(eff.get("amount"), 0.15),
                monochrome=_b(eff.get("monochrome", True), True),
            )

        # background_blur / progressive_blur are intentionally unsupported here.

    return under, work, over
