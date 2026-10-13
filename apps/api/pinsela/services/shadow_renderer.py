"""Shadow expansion helpers for the macro preprocessor.

The native Pillow renderer doesn't support ``style.effects[]`` drop shadows.
We fake a soft shadow by emitting N copies of the source shape with a small
progressive offset and decaying alpha, stacked below the original.

For a hard 1px shadow we still emit a single layer. For a 16px blur we emit
6-10 layers, each shifted by a fractional offset, so the silhouette feathers
out naturally.

These helpers are pure: same input → same output. They return a list of new
node dicts ready to be inserted into ``doc["nodes"]``. Z-index is set so the
shadow layers sit *below* the source node.
"""

from __future__ import annotations

import copy
import hashlib
from typing import Any, Dict, List, Tuple


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _stable_suffix(seed: str, layer_index: int) -> str:
    """Deterministic suffix for child node ids so reruns produce identical docs."""
    h = hashlib.sha256(f"{seed}::shadow::{layer_index}".encode("utf-8")).hexdigest()
    return h[:10]


def _strip_for_shadow(node: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-copy a node and prepare it as a shadow silhouette.

    - removes text, image_src, bindings-related fields
    - normalises fill to opaque (we'll re-apply alpha via mul_alpha on the color)
    - keeps geometry/shape so silhouette matches
    """
    out = copy.deepcopy(node)
    out["text"] = None
    out["text_runs"] = []
    out["image_src"] = None
    out["image_asset_id"] = None
    out["editable"] = False
    out.pop("component_instance", None)
    # Children are not duplicated — they would render on top and break the silhouette.
    out["children_ids"] = []
    # Drop nested macros to avoid recursive expansion.
    out.pop("_macros", None)
    style = out.get("style") if isinstance(out.get("style"), dict) else {}
    style = dict(style)
    style["effects"] = []
    style["strokes"] = []
    style["stroke"] = None
    style.pop("image_brush_strokes", None)
    style.pop("image_brush_settings", None)
    style.pop("image_duotone", None)
    out["style"] = style
    return out


def _hex_with_alpha(color: Any, alpha: float) -> str:
    """Return an #RRGGBBAA string for color * alpha (0..1)."""
    # Reuse the same parser the gradient renderer uses so logic stays consistent.
    from pinsela.services.gradient_renderer import _parse_color

    r, g, b, a = _parse_color(color)
    a_eff = int(round((a / 255.0) * _clamp(alpha, 0.0, 1.0) * 255.0))
    a_eff = max(0, min(255, a_eff))
    return f"#{r:02X}{g:02X}{b:02X}{a_eff:02X}"


def make_shadow_layers(
    node: Dict[str, Any],
    *,
    offset_x: float,
    offset_y: float,
    blur_px: float,
    color: Any = "#000000",
    opacity: float = 0.35,
    layer_count: int | None = None,
    parent_id: str | None = None,
    base_z: int | None = None,
) -> List[Dict[str, Any]]:
    """Generate stacked shadow layers for a node.

    Returns a list (deepest first) of node dicts. The caller is responsible
    for inserting them into ``doc["nodes"]`` and registering them under the
    same parent_id.
    """
    blur = max(0.0, float(blur_px))
    # Layer count scales with blur. 0 blur → 1 sharp layer; 32px → ~10 layers.
    if layer_count is None:
        if blur <= 0.5:
            layer_count = 1
        else:
            layer_count = max(4, min(10, int(round(2 + blur / 3.5))))
    layer_count = max(1, int(layer_count))

    seed = str(node.get("id") or "node")
    src_geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
    src_x = float(src_geom.get("x", 0))
    src_y = float(src_geom.get("y", 0))
    src_w = float(src_geom.get("width", src_geom.get("w", 0)) or 0)
    src_h = float(src_geom.get("height", src_geom.get("h", 0)) or 0)
    src_z = int(src_geom.get("z_index", base_z if base_z is not None else 0))

    layers: List[Dict[str, Any]] = []
    # Feather: outermost layer has the largest spread + lowest alpha.
    # Innermost layer has the smallest spread + strongest alpha (≈source).
    for i in range(layer_count):
        # progress 0..1, 0 = outermost (most spread), 1 = innermost (least spread)
        if layer_count == 1:
            progress = 0.0
        else:
            progress = i / (layer_count - 1)
        # spread shrinks from full blur to 0 going inward
        spread = blur * (1.0 - progress)
        # alpha rises slightly with progress to mimic the bell-shaped falloff
        # of a true Gaussian blur peak. Outer layers are very transparent.
        layer_alpha = opacity * (0.18 + 0.55 * progress)
        layer_alpha = _clamp(layer_alpha, 0.0, 1.0)

        # offset: outermost is shifted further to fake directional displacement
        # then inner layers march back toward source offset (no overshoot).
        ox = offset_x + (spread * 0.0)  # no extra horizontal feather drift
        oy = offset_y + (spread * 0.0)

        # Geometry: expand outward by `spread` to simulate Gaussian halo.
        new_x = src_x + ox - spread / 2.0
        new_y = src_y + oy - spread / 2.0
        new_w = src_w + spread
        new_h = src_h + spread

        layer_node = _strip_for_shadow(node)
        layer_node["id"] = f"{seed}__shadow_{i:02d}_{_stable_suffix(seed, i)}"
        layer_node["name"] = f"{node.get('name') or seed} shadow {i+1}/{layer_count}"
        layer_node["parent_id"] = parent_id if parent_id is not None else node.get("parent_id")
        geom = dict(layer_node.get("geometry") or {})
        geom["x"] = new_x
        geom["y"] = new_y
        geom["width"] = max(0.0, new_w)
        geom["height"] = max(0.0, new_h)
        # Outer layers should also bump corner radius slightly so the halo curves.
        if "corner_radius" in geom:
            try:
                geom["corner_radius"] = float(geom.get("corner_radius") or 0.0) + spread / 2.0
            except Exception:
                pass
        # z_index: place below the source. Outermost shadow lowest.
        geom["z_index"] = src_z - (layer_count - i)
        layer_node["geometry"] = geom

        style = dict(layer_node.get("style") or {})
        style["fill"] = _hex_with_alpha(color, layer_alpha)
        # For paths/lines/text: still treat as solid silhouette.
        style["opacity"] = 1.0
        # If source was a text/image kind, render as a frame silhouette instead.
        if node.get("kind") in {"text", "image", "line", "path"}:
            layer_node["kind"] = "rect"
        layer_node["style"] = style

        layers.append(layer_node)

    return layers
