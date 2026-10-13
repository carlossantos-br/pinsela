"""Doc macro preprocessor for Pinsela native docs.

The native Pillow renderer ignores ``style.effects[]`` silently. To support
drop shadows, glows, gradients and brushes WITHOUT modifying the renderer,
we expand them as sibling primitives before rendering.

Usage:

    from pinsela.services.doc_macros import expand_macros

    expanded = expand_macros(my_doc)
    rendered = render_native_template(expanded, payload, db=None)

Macros live on each node as an optional ``_macros`` dict. The preprocessor:

    1. deep-copies the doc
    2. walks every node
    3. for each macro present, expands into 1+ additional nodes
    4. registers the new nodes under the same parent_id with proper z-index
    5. removes ``_macros`` from the original node so validation passes

Order of expansion matters: shadows → glows → gradients → brushes. Gradients
mutate the source node's fill/image; shadows and glows must capture the
original silhouette first.

Cache safety: every helper is a pure function of its inputs. Generated PNGs
(gradients) are cached on disk by SHA256.
"""

from __future__ import annotations

import copy
import hashlib
import math
import random
from typing import Any, Dict, List, Tuple

from pinsela.services.component_expander import expand_components
from pinsela.services.gradient_renderer import (
    render_gradient_to_file,
)
from pinsela.services.shadow_renderer import (
    _hex_with_alpha,
    _stable_suffix,
    make_shadow_layers,
)
from pinsela.services.token_resolver import resolve_tokens


# --------------------------------------------------------------------------- #
# Public API.
# --------------------------------------------------------------------------- #


SUPPORTED_MACROS = {
    "drop_shadow",
    "glow",
    "gradient",
    "brush",
    # New macros (2026-05-26) — plug high-priority renderer gaps.
    "metallic",
    "photo_tint",
    "soft_shadow",
    "photo_border",
    "corner_brackets",
    "vignette",
}


def expand_macros(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return a deep-copy of ``doc`` with every node's ``_macros`` expanded.

    The returned doc no longer contains ``_macros`` on any node. It is safe to
    pass directly to ``validate_native_doc`` and ``render_native_template``.

    Pipeline order (added 2026-05-27):
        0a) resolve_tokens — replace ``$tokens.*`` references with actual values
        0b) expand_components — inline every component_instance into nodes
        1-10) shadow/glow/brush/gradient/metallic/tint/etc. macros (original)
    """
    if not isinstance(doc, dict):
        raise TypeError("expand_macros expects a dict")
    # Token + component preprocessing happens BEFORE macros so any tokens
    # baked into a component definition (e.g. brand colors, font stacks) get
    # resolved across the whole expanded tree in one pass. Each step returns
    # a deep-copy, so the original input is never mutated.
    doc = resolve_tokens(doc)
    doc = expand_components(doc)
    # resolve_tokens again — component definitions can themselves contain
    # $tokens.* refs; running it post-expansion catches those.
    doc = resolve_tokens(doc)

    out = copy.deepcopy(doc)
    nodes = out.get("nodes")
    if not isinstance(nodes, list):
        return out

    # Snapshot the originals so we expand based on authored state, not
    # progressively mutated nodes.
    originals = [copy.deepcopy(n) for n in nodes if isinstance(n, dict)]

    # 1) Shadows.
    shadow_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        shadow_spec = macros.get("drop_shadow")
        if shadow_spec:
            shadow_nodes.extend(_expand_drop_shadow(src, shadow_spec))

    # 2) Glows.
    glow_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        glow_spec = macros.get("glow")
        if glow_spec:
            glow_nodes.extend(_expand_glow(src, glow_spec))

    # 3) Brushes (additive: emit extra stroke layers).
    brush_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        brush_spec = macros.get("brush")
        if brush_spec:
            brush_nodes.extend(_expand_brush(src, brush_spec))

    # 4) Gradients — mutate existing nodes in `nodes` in-place (point image_src).
    by_id = {n.get("id"): n for n in nodes if isinstance(n, dict)}
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        grad_spec = macros.get("gradient")
        if grad_spec:
            target = by_id.get(src.get("id"))
            if target is not None:
                _apply_gradient(target, grad_spec)

    # 5) Metallic — like gradient but with noise + curated 3-stop default.
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        spec = macros.get("metallic")
        if spec:
            target = by_id.get(src.get("id"))
            if target is not None:
                _apply_metallic(target, spec)

    # 6) Photo tint — translucent colored overlay over an image node.
    tint_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        spec = macros.get("photo_tint") or macros.get("tint")
        if spec:
            tint_nodes.extend(_expand_photo_tint(src, spec))

    # 7) Soft shadow — true Gaussian shadow PNG behind the source.
    soft_shadow_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        spec = macros.get("soft_shadow")
        if spec:
            soft_shadow_nodes.extend(_expand_soft_shadow(src, spec))

    # 8) Photo border — inset stroke on top of an image.
    border_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        spec = macros.get("photo_border") or macros.get("inner_border")
        if spec:
            border_nodes.extend(_expand_photo_border(src, spec))

    # 9) Corner brackets — 4 L-shapes at the corners of a frame.
    bracket_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        spec = macros.get("corner_brackets")
        if spec:
            bracket_nodes.extend(_expand_corner_brackets(src, spec))

    # 10) Vignette — radial dark overlay around an image.
    vignette_nodes: List[Dict[str, Any]] = []
    for src in originals:
        macros = src.get("_macros") if isinstance(src.get("_macros"), dict) else None
        if not macros:
            continue
        spec = macros.get("vignette")
        if spec:
            vignette_nodes.extend(_expand_vignette(src, spec))

    # Strip _macros from the live nodes so the validator doesn't carry them.
    for n in nodes:
        if isinstance(n, dict):
            n.pop("_macros", None)

    # Insert generated nodes. Each must be registered as a child of its parent.
    new_nodes = (
        shadow_nodes
        + glow_nodes
        + brush_nodes
        + tint_nodes
        + soft_shadow_nodes
        + border_nodes
        + bracket_nodes
        + vignette_nodes
    )
    if new_nodes:
        _attach_to_parents(out, new_nodes)
        nodes.extend(new_nodes)

    out["_macro_stats"] = {
        "shadow_layers": len(shadow_nodes),
        "glow_layers": len(glow_nodes),
        "brush_layers": len(brush_nodes),
        "tint_layers": len(tint_nodes),
        "soft_shadow_layers": len(soft_shadow_nodes),
        "photo_border_layers": len(border_nodes),
        "corner_bracket_layers": len(bracket_nodes),
        "vignette_layers": len(vignette_nodes),
        "gradients_applied": sum(
            1
            for n in originals
            if isinstance(n.get("_macros"), dict) and n["_macros"].get("gradient")
        ),
        "metallic_applied": sum(
            1
            for n in originals
            if isinstance(n.get("_macros"), dict) and n["_macros"].get("metallic")
        ),
    }
    return out


def added_nodes_count(doc: Dict[str, Any]) -> int:
    stats = doc.get("_macro_stats") or {}
    return (
        int(stats.get("shadow_layers", 0))
        + int(stats.get("glow_layers", 0))
        + int(stats.get("brush_layers", 0))
        + int(stats.get("tint_layers", 0))
        + int(stats.get("soft_shadow_layers", 0))
        + int(stats.get("photo_border_layers", 0))
        + int(stats.get("corner_bracket_layers", 0))
        + int(stats.get("vignette_layers", 0))
    )


# --------------------------------------------------------------------------- #
# Individual macro expansions.
# --------------------------------------------------------------------------- #


def _expand_drop_shadow(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Generate stacked silhouette layers behind the source node."""
    offset_x = float(spec.get("offset_x", 0))
    offset_y = float(spec.get("offset_y", 4))
    blur_px = float(spec.get("blur_px", spec.get("blur", 8)))
    color = spec.get("color", "#000000")
    opacity = float(spec.get("opacity", 0.35))
    layer_count = spec.get("layer_count")
    if layer_count is not None:
        try:
            layer_count = int(layer_count)
        except Exception:
            layer_count = None
    return make_shadow_layers(
        src,
        offset_x=offset_x,
        offset_y=offset_y,
        blur_px=blur_px,
        color=color,
        opacity=opacity,
        layer_count=layer_count,
        parent_id=src.get("parent_id"),
    )


def _expand_glow(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Outer glow: silhouettes centred on source with growing spread."""
    radius = float(spec.get("radius", spec.get("blur_px", 24)))
    intensity = float(spec.get("intensity", spec.get("opacity", 0.55)))
    color = spec.get("color", "#FFFFFF")
    layer_count = int(spec.get("layer_count") or max(5, min(12, int(round(2 + radius / 3.0)))))

    seed = str(src.get("id") or "node")
    src_geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    src_x = float(src_geom.get("x", 0))
    src_y = float(src_geom.get("y", 0))
    src_w = float(src_geom.get("width", 0))
    src_h = float(src_geom.get("height", 0))
    src_z = int(src_geom.get("z_index", 0))

    layers: List[Dict[str, Any]] = []
    for i in range(layer_count):
        progress = 0.0 if layer_count == 1 else i / (layer_count - 1)
        spread = radius * (1.0 - progress)
        layer_alpha = intensity * (0.12 + 0.55 * progress)
        from pinsela.services.shadow_renderer import _strip_for_shadow

        layer = _strip_for_shadow(src)
        layer["id"] = f"{seed}__glow_{i:02d}_{_stable_suffix(seed, 1000 + i)}"
        layer["name"] = f"{src.get('name') or seed} glow {i+1}/{layer_count}"
        layer["parent_id"] = src.get("parent_id")
        geom = dict(layer.get("geometry") or {})
        geom["x"] = src_x - spread
        geom["y"] = src_y - spread
        geom["width"] = src_w + spread * 2.0
        geom["height"] = src_h + spread * 2.0
        try:
            geom["corner_radius"] = float(geom.get("corner_radius") or 0.0) + spread
        except Exception:
            pass
        geom["z_index"] = src_z - (layer_count - i) - 1
        layer["geometry"] = geom
        style = dict(layer.get("style") or {})
        style["fill"] = _hex_with_alpha(color, layer_alpha)
        style["opacity"] = 1.0
        if src.get("kind") in {"text", "image", "line", "path"}:
            layer["kind"] = "rect"
        layer["style"] = style
        layers.append(layer)
    return layers


def _expand_brush(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Brush macro: emits multiple jittered overlapping primitives over the node.

    The native renderer doesn't have textures, so a "brush" effect is faked
    with several lightly-displaced semi-transparent strokes/dots. This works
    well for ``rect``/``line``/``path`` kinds; for other kinds we fall back
    to a small set of overlapping rects across the bounding box.
    """
    preset = str(spec.get("preset") or "ink").lower()
    color = spec.get("color", "#1F1F1F")
    weight = float(spec.get("weight", 6.0))
    count = int(spec.get("count") or {"ink": 6, "marker": 5, "chalk": 14, "spray": 22}.get(preset, 6))

    seed = str(src.get("id") or "node")
    src_geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    src_x = float(src_geom.get("x", 0))
    src_y = float(src_geom.get("y", 0))
    src_w = float(src_geom.get("width", 0))
    src_h = float(src_geom.get("height", 0))
    src_z = int(src_geom.get("z_index", 0))

    # Deterministic jitter from node id so reruns are stable.
    rng = random.Random(int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16))

    layers: List[Dict[str, Any]] = []
    for i in range(count):
        jitter_x = (rng.random() - 0.5) * weight * (2.0 if preset == "spray" else 0.8)
        jitter_y = (rng.random() - 0.5) * weight * (2.0 if preset == "spray" else 0.8)
        size = weight * (
            0.4 + rng.random() * (1.6 if preset in {"chalk", "spray"} else 0.6)
        )
        alpha = {
            "ink": 0.55,
            "marker": 0.42,
            "chalk": 0.28,
            "spray": 0.18,
        }.get(preset, 0.4)
        alpha *= 0.6 + rng.random() * 0.6  # vary opacity per stroke

        if preset in {"chalk", "spray"} and src_w > 0 and src_h > 0:
            # Scatter dots over the source bbox.
            cx = src_x + rng.random() * src_w
            cy = src_y + rng.random() * src_h
            new_x = cx - size / 2.0
            new_y = cy - size / 2.0
            new_w = size
            new_h = size
        else:
            # Trace a stroke roughly along the node's diagonal/bbox.
            new_x = src_x + jitter_x
            new_y = src_y + jitter_y
            new_w = src_w
            new_h = src_h

        layer = {
            "id": f"{seed}__brush_{i:02d}_{_stable_suffix(seed, 2000 + i)}",
            "kind": "rect",
            "name": f"{src.get('name') or seed} brush {preset} {i+1}/{count}",
            "parent_id": src.get("parent_id"),
            "children_ids": [],
            "geometry": {
                "x": new_x,
                "y": new_y,
                "width": max(1.0, new_w),
                "height": max(1.0, new_h),
                "rotation": 0,
                "corner_radius": size / 2.0 if preset in {"chalk", "spray"} else 2.0,
                "z_index": src_z + 1 + i,
                "clip": False,
            },
            "style": {
                "visible": True,
                "fill": _hex_with_alpha(color, alpha),
                "opacity": 1.0,
            },
            "text": None,
            "text_runs": [],
            "image_src": None,
        }
        layers.append(layer)
    return layers


def _apply_metallic(node: Dict[str, Any], spec: Dict[str, Any]) -> None:
    """Render a metallic gradient (with noise) and place it as image_src.

    Spec:
        colors: [#XX, #XX, #XX] — 2 or 3 stops (default gold ramp)
        direction: 'vertical' | 'horizontal' (default 'vertical')
        noise: 0.0..1.0 (default 0.08)

    Equivalent to a gradient macro with `noise` enabled and a curated default
    palette. Produces the brushed-metal eyebrow seen in metallic brand refs.
    """
    geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
    w = max(1, int(round(float(geom.get("width", 0)) or 0)))
    h = max(1, int(round(float(geom.get("height", 0)) or 0)))
    if w <= 1 or h <= 1:
        return

    colors = spec.get("colors") or ["#B8893F", "#F5D88A", "#8E6A2F"]
    direction = str(spec.get("direction") or "vertical").lower()
    noise = float(spec.get("noise", 0.08))
    transparent = bool(spec.get("transparent", False))

    if len(colors) == 2:
        stops = [
            {"offset": 0.0, "color": colors[0]},
            {"offset": 1.0, "color": colors[1]},
        ]
    else:
        # 3+ colors: distribute evenly.
        n = len(colors)
        stops = [
            {"offset": (i / (n - 1)) if n > 1 else 0.0, "color": c}
            for i, c in enumerate(colors)
        ]

    angle = 90.0 if direction == "vertical" else 0.0

    cap = 2048
    grad_w = min(w, cap)
    grad_h = min(h, cap)

    path, _bytes = render_gradient_to_file(
        width=grad_w,
        height=grad_h,
        gradient_type="linear",
        angle=angle,
        stops=stops,
        transparent=transparent,
        noise=noise,
    )
    node["image_src"] = str(path)
    style = dict(node.get("style") or {})
    style["image_fit"] = "fill"
    if transparent:
        style["fill"] = "#00000000"
    node["style"] = style
    if node.get("kind") not in {"frame", "rect", "group", "image"}:
        node["kind"] = "rect"


def _expand_photo_tint(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Emit a translucent colored rect sitting on top of the image.

    Spec:
        color: '#XX' — tint color
        strength: 0.0..1.0 — alpha (default 0.18)
    """
    color = spec.get("color", "#D4A867")
    strength = max(0.0, min(1.0, float(spec.get("strength", 0.18))))
    if strength <= 0:
        return []

    seed = str(src.get("id") or "node")
    geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    src_x = float(geom.get("x", 0))
    src_y = float(geom.get("y", 0))
    src_w = float(geom.get("width", 0))
    src_h = float(geom.get("height", 0))
    src_z = int(geom.get("z_index", 0))
    src_radius = float(geom.get("corner_radius", 0) or 0)

    layer = {
        "id": f"{seed}__tint_{_stable_suffix(seed, 5000)}",
        "kind": "rect",
        "name": f"{src.get('name') or seed} tint",
        "parent_id": src.get("parent_id"),
        "children_ids": [],
        "geometry": {
            "x": src_x,
            "y": src_y,
            "width": max(1.0, src_w),
            "height": max(1.0, src_h),
            "rotation": float(geom.get("rotation", 0)),
            "corner_radius": src_radius,
            "z_index": src_z + 1,
            "clip": False,
        },
        "style": {
            "visible": True,
            "fill": _hex_with_alpha(color, strength),
            "opacity": 1.0,
        },
        "text": None,
        "text_runs": [],
        "image_src": None,
    }
    return [layer]


def _expand_soft_shadow(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pre-render a true Gaussian shadow PNG and insert it behind the source.

    Spec:
        offset_x, offset_y (default 0, 12)
        blur (default 24) — Gaussian radius in pixels
        color (default #000000)
        opacity (default 0.30)

    Produces a single image node with the pre-rendered soft shadow — much
    cleaner than the stacked-rect approach used by ``drop_shadow``.
    """
    from PIL import Image, ImageDraw, ImageFilter

    from pinsela.services.gradient_renderer import (
        DEFAULT_CACHE_DIR,
        _ensure_dir,
        _parse_color,
        _png_bytes,
        _cache_key,
    )

    offset_x = float(spec.get("offset_x", 0))
    offset_y = float(spec.get("offset_y", 12))
    blur = max(0.5, float(spec.get("blur", spec.get("blur_px", 24))))
    color = spec.get("color", "#000000")
    opacity = max(0.0, min(1.0, float(spec.get("opacity", 0.30))))

    seed = str(src.get("id") or "node")
    geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    src_x = float(geom.get("x", 0))
    src_y = float(geom.get("y", 0))
    src_w = float(geom.get("width", 0))
    src_h = float(geom.get("height", 0))
    src_z = int(geom.get("z_index", 0))
    src_radius = float(geom.get("corner_radius", 0) or 0)

    if src_w <= 1 or src_h <= 1:
        return []

    # Render shadow at the silhouette size + padding for blur bleed.
    pad = int(math.ceil(blur * 2.5)) + 4
    sw = int(round(src_w)) + pad * 2
    sh = int(round(src_h)) + pad * 2

    # Cache key includes shape + blur params so reruns hit disk cache.
    key_payload = {
        "kind": "soft_shadow",
        "w": int(round(src_w)),
        "h": int(round(src_h)),
        "r": round(src_radius, 3),
        "blur": round(blur, 3),
        "color": str(color),
        "v": 1,
    }
    key = _cache_key(key_payload)
    cache_dir = DEFAULT_CACHE_DIR
    _ensure_dir(cache_dir)
    cache_path = cache_dir / f"soft_shadow_{key}.png"

    if not (cache_path.exists() and cache_path.stat().st_size > 0):
        img = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        r, g, b, _a = _parse_color(color)
        # Draw opaque silhouette; opacity is applied via the rect overlay's alpha.
        if src_radius > 0:
            draw.rounded_rectangle(
                (pad, pad, pad + int(round(src_w)), pad + int(round(src_h))),
                radius=int(round(src_radius)),
                fill=(r, g, b, 255),
            )
        else:
            draw.rectangle(
                (pad, pad, pad + int(round(src_w)), pad + int(round(src_h))),
                fill=(r, g, b, 255),
            )
        # Gaussian blur for proper soft falloff.
        img = img.filter(ImageFilter.GaussianBlur(radius=blur))
        try:
            cache_path.write_bytes(_png_bytes(img))
        except Exception:
            pass

    # Place the shadow PNG as an image node behind the source.
    layer = {
        "id": f"{seed}__softshadow_{_stable_suffix(seed, 6000)}",
        "kind": "image",
        "name": f"{src.get('name') or seed} soft shadow",
        "parent_id": src.get("parent_id"),
        "children_ids": [],
        "geometry": {
            "x": src_x - pad + offset_x,
            "y": src_y - pad + offset_y,
            "width": float(sw),
            "height": float(sh),
            "rotation": 0,
            "corner_radius": 0,
            "z_index": src_z - 1,
            "clip": False,
        },
        "style": {
            "visible": True,
            "fill": "#00000000",
            "opacity": float(opacity),
            "image_fit": "fill",
        },
        "text": None,
        "text_runs": [],
        "image_src": str(cache_path),
    }
    return [layer]


def _expand_photo_border(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Add an inset stroke rect on top of an image (transparent fill + stroke).

    Spec:
        color: '#XX' (default '#9B7B3F')
        weight: float px (default 2)
    """
    color = spec.get("color", "#9B7B3F")
    weight = max(0.5, float(spec.get("weight", 2.0)))

    seed = str(src.get("id") or "node")
    geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    src_x = float(geom.get("x", 0))
    src_y = float(geom.get("y", 0))
    src_w = float(geom.get("width", 0))
    src_h = float(geom.get("height", 0))
    src_z = int(geom.get("z_index", 0))
    src_radius = float(geom.get("corner_radius", 0) or 0)

    if src_w <= 1 or src_h <= 1:
        return []

    inset = weight / 2.0
    layer = {
        "id": f"{seed}__border_{_stable_suffix(seed, 7000)}",
        "kind": "rect",
        "name": f"{src.get('name') or seed} photo border",
        "parent_id": src.get("parent_id"),
        "children_ids": [],
        "geometry": {
            "x": src_x + inset,
            "y": src_y + inset,
            "width": max(1.0, src_w - weight),
            "height": max(1.0, src_h - weight),
            "rotation": float(geom.get("rotation", 0)),
            "corner_radius": max(0.0, src_radius - inset),
            "z_index": src_z + 2,
            "clip": False,
        },
        "style": {
            "visible": True,
            "fill": "#00000000",
            "opacity": 1.0,
            "stroke": {
                "color": color,
                "width": float(weight),
            },
        },
        "text": None,
        "text_runs": [],
        "image_src": None,
    }
    return [layer]


def _expand_corner_brackets(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build 4 L-shaped corner brackets around a frame's bbox.

    Spec:
        length: arm length in px (default 60)
        weight: arm thickness in px (default 3)
        color: '#XX' (default '#9B7B3F')
        inset: offset OUTSIDE the frame edges in px (default 24, negative = inside)
    """
    length = max(4.0, float(spec.get("length", 60)))
    weight = max(1.0, float(spec.get("weight", 3)))
    color = spec.get("color", "#9B7B3F")
    inset = float(spec.get("inset", 24))

    seed = str(src.get("id") or "frame")
    geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    fx = float(geom.get("x", 0))
    fy = float(geom.get("y", 0))
    fw = float(geom.get("width", 0))
    fh = float(geom.get("height", 0))
    fz = int(geom.get("z_index", 0))

    if fw <= 1 or fh <= 1:
        return []

    # Corner anchors expanded by inset.
    left = fx - inset
    top = fy - inset
    right = fx + fw + inset
    bottom = fy + fh + inset

    corners = [
        # (corner_name, x_h, y_h, x_v, y_v) where _h is horizontal arm, _v vertical arm
        ("tl", left, top, left, top),               # top-left
        ("tr", right - length, top, right - weight, top),  # top-right
        ("bl", left, bottom - weight, left, bottom - length),  # bottom-left
        ("br", right - length, bottom - weight, right - weight, bottom - length),  # bottom-right
    ]

    layers: List[Dict[str, Any]] = []
    for i, (name, xh, yh, xv, yv) in enumerate(corners):
        # Horizontal arm.
        layers.append({
            "id": f"{seed}__bracket_{name}_h_{_stable_suffix(seed, 8000 + i * 2)}",
            "kind": "rect",
            "name": f"{src.get('name') or seed} bracket {name} horizontal",
            "parent_id": src.get("parent_id"),
            "children_ids": [],
            "geometry": {
                "x": xh,
                "y": yh,
                "width": length,
                "height": weight,
                "rotation": 0,
                "corner_radius": weight / 2.0,
                "z_index": fz + 10,
                "clip": False,
            },
            "style": {
                "visible": True,
                "fill": color,
                "opacity": 1.0,
            },
            "text": None,
            "text_runs": [],
            "image_src": None,
        })
        # Vertical arm.
        layers.append({
            "id": f"{seed}__bracket_{name}_v_{_stable_suffix(seed, 8001 + i * 2)}",
            "kind": "rect",
            "name": f"{src.get('name') or seed} bracket {name} vertical",
            "parent_id": src.get("parent_id"),
            "children_ids": [],
            "geometry": {
                "x": xv,
                "y": yv,
                "width": weight,
                "height": length,
                "rotation": 0,
                "corner_radius": weight / 2.0,
                "z_index": fz + 10,
                "clip": False,
            },
            "style": {
                "visible": True,
                "fill": color,
                "opacity": 1.0,
            },
            "text": None,
            "text_runs": [],
            "image_src": None,
        })
    return layers


def _expand_vignette(src: Dict[str, Any], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Add a radial dark overlay around an image (subtle vignette).

    Spec:
        color: '#XX' (default '#000000')
        strength: 0..1 (default 0.45) — alpha at corners
        falloff: 0..1 (default 0.55) — inner radius before darkening
    """
    color = spec.get("color", "#000000")
    strength = max(0.0, min(1.0, float(spec.get("strength", 0.45))))
    falloff = max(0.0, min(0.95, float(spec.get("falloff", 0.55))))

    seed = str(src.get("id") or "node")
    geom = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    src_x = float(geom.get("x", 0))
    src_y = float(geom.get("y", 0))
    src_w = float(geom.get("width", 0))
    src_h = float(geom.get("height", 0))
    src_z = int(geom.get("z_index", 0))
    src_radius = float(geom.get("corner_radius", 0) or 0)

    if src_w <= 1 or src_h <= 1:
        return []

    w = max(1, int(round(src_w)))
    h = max(1, int(round(src_h)))
    cap = 2048
    gw = min(w, cap)
    gh = min(h, cap)

    stops = [
        {"offset": 0.0, "color": f"{color}00"},
        {"offset": max(0.05, falloff), "color": f"{color}00"},
        {"offset": 1.0, "color": _hex_with_alpha(color, strength)},
    ]

    path, _bytes = render_gradient_to_file(
        width=gw,
        height=gh,
        gradient_type="radial",
        stops=stops,
        transparent=True,
    )

    layer = {
        "id": f"{seed}__vignette_{_stable_suffix(seed, 9000)}",
        "kind": "image",
        "name": f"{src.get('name') or seed} vignette",
        "parent_id": src.get("parent_id"),
        "children_ids": [],
        "geometry": {
            "x": src_x,
            "y": src_y,
            "width": src_w,
            "height": src_h,
            "rotation": float(geom.get("rotation", 0)),
            "corner_radius": src_radius,
            "z_index": src_z + 1,
            "clip": True,
        },
        "style": {
            "visible": True,
            "fill": "#00000000",
            "opacity": 1.0,
            "image_fit": "fill",
        },
        "text": None,
        "text_runs": [],
        "image_src": str(path),
    }
    return [layer]


def _apply_gradient(node: Dict[str, Any], spec: Dict[str, Any]) -> None:
    """Replace the node's fill with a generated gradient PNG via image_src."""
    geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
    w = max(1, int(round(float(geom.get("width", 0)) or 0)))
    h = max(1, int(round(float(geom.get("height", 0)) or 0)))
    if w <= 1 or h <= 1:
        # Without geometry we cannot pre-render. Skip.
        return

    gradient_type = str(spec.get("type") or "linear").lower()
    angle = float(spec.get("angle", 0.0))
    stops = spec.get("stops") or [
        {"offset": 0.0, "color": "#000000"},
        {"offset": 1.0, "color": "#FFFFFF"},
    ]
    transparent = bool(spec.get("transparent", False))
    center = None
    if isinstance(spec.get("center"), (list, tuple)) and len(spec["center"]) == 2:
        center = (float(spec["center"][0]), float(spec["center"][1]))
    radius = spec.get("radius")
    if radius is not None:
        try:
            radius = float(radius)
        except Exception:
            radius = None

    # Cap dimensions for the gradient asset so we don't render huge bitmaps.
    cap = 2048
    grad_w = min(w, cap)
    grad_h = min(h, cap)

    path, _bytes = render_gradient_to_file(
        width=grad_w,
        height=grad_h,
        gradient_type=gradient_type,
        angle=angle,
        center=center,
        radius=radius,
        stops=stops,
        transparent=transparent,
    )
    node["image_src"] = str(path)
    style = node.get("style") if isinstance(node.get("style"), dict) else {}
    style = dict(style)
    # The renderer composites image *over* fill; keep fill transparent to avoid
    # double-layering. Image fit "fill" stretches to the bbox.
    style["image_fit"] = "fill"
    if transparent:
        # Make sure no opaque solid leaks through.
        style["fill"] = "#00000000"
    node["style"] = style
    # If the kind didn't support images, promote to a frame so the renderer
    # composites the asset onto it.
    if node.get("kind") not in {"frame", "rect", "group", "image"}:
        node["kind"] = "rect"


# --------------------------------------------------------------------------- #
# Parent registration.
# --------------------------------------------------------------------------- #


def _attach_to_parents(doc: Dict[str, Any], new_nodes: List[Dict[str, Any]]) -> None:
    """Append every new node's id to the children_ids of its parent."""
    nodes = doc.get("nodes")
    if not isinstance(nodes, list):
        return
    by_id: Dict[str, Dict[str, Any]] = {n.get("id"): n for n in nodes if isinstance(n, dict)}
    for new in new_nodes:
        pid = new.get("parent_id")
        if not pid:
            continue
        parent = by_id.get(pid)
        if parent is None:
            continue
        children = parent.get("children_ids")
        if not isinstance(children, list):
            children = []
            parent["children_ids"] = children
        if new["id"] not in children:
            children.append(new["id"])
