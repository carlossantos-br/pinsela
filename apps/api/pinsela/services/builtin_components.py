"""Built-in component library for Pinsela native docs.

Each builder returns a fully-formed component definition dict that can be
appended to ``doc.metadata.components.definitions`` and then instantiated
elsewhere in the document via ``kind: component_instance``.

Conventions:
    - The authoring viewport is declared on the definition's ``width``/
      ``height`` fields; instances can re-scale by setting their own bbox.
    - Default style uses tokens like ``$tokens.colors.primary`` so a single
      ``doc.tokens`` swap re-skins every component instance.
    - Each definition keeps its node ids LOCAL (no instance prefix). The
      expander adds the prefix at substitution time.
    - All builders are pure functions: identical args → identical dict.

Usage::

    from pinsela.services.builtin_components import inject_builtins

    doc = inject_builtins(doc)
    # doc.metadata.components.definitions now contains all built-ins

    # Reference one in nodes:
    {
        "id": "card_1",
        "kind": "component_instance",
        "component_id": "price_card",
        "parent_id": "page",
        "props": {"price": "R$ 99,90", "unit": "per unit"},
        "geometry": {"x": 80, "y": 600, "width": 320, "height": 200, "z_index": 10}
    }
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List


# --------------------------------------------------------------------------- #
# Definitions.
# --------------------------------------------------------------------------- #


def price_card() -> Dict[str, Any]:
    """A 320x200 card showing a big price + smaller unit label.

    Props:
        price: e.g. "R$ 99,90"
        unit:  e.g. "per unit"
    """
    return {
        "id": "price_card",
        "params": ["price", "unit"],
        "defaults": {"unit": "per unit"},
        "width": 320,
        "height": 200,
        "nodes": [
            {
                "id": "bg",
                "kind": "rect",
                "name": "price card bg",
                "parent_id": None,
                "children_ids": ["price", "unit_lbl"],
                "geometry": {
                    "x": 0, "y": 0, "width": 320, "height": 200,
                    "rotation": 0, "corner_radius": 18, "z_index": 0, "clip": False
                },
                "style": {
                    "visible": True,
                    "fill": "$tokens.colors.primary",
                    "opacity": 1.0,
                },
                "text": None,
                "text_runs": [],
                "image_src": None,
            },
            {
                "id": "price",
                "kind": "text",
                "name": "price text",
                "parent_id": "bg",
                "children_ids": [],
                "geometry": {
                    "x": 16, "y": 28, "width": 288, "height": 96,
                    "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False
                },
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0},
                "text": "{{price}}",
                "text_runs": [
                    {
                        "text": "{{price}}",
                        "style": "$tokens.fonts.headline",
                        "fill": "$tokens.colors.paper",
                    }
                ],
                "image_src": None,
            },
            {
                "id": "unit_lbl",
                "kind": "text",
                "name": "price unit",
                "parent_id": "bg",
                "children_ids": [],
                "geometry": {
                    "x": 16, "y": 140, "width": 288, "height": 36,
                    "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False
                },
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0},
                "text": "{{unit}}",
                "text_runs": [
                    {
                        "text": "{{unit}}",
                        "style": "$tokens.fonts.body",
                        "fill": "$tokens.colors.paper",
                    }
                ],
                "image_src": None,
            },
        ],
    }


def title_header() -> Dict[str, Any]:
    """A 1080x320 header strip with a brand logo image + title + subtitle.

    Props:
        brand_logo_asset: path/url to logo image
        title:            big headline
        subtitle:         eyebrow/subtitle text
    """
    return {
        "id": "title_header",
        "params": ["brand_logo_asset", "title", "subtitle"],
        "defaults": {"subtitle": ""},
        "width": 1080,
        "height": 320,
        "nodes": [
            {
                "id": "bg",
                "kind": "rect",
                "name": "header bg",
                "parent_id": None,
                "children_ids": ["logo", "title", "subtitle"],
                "geometry": {
                    "x": 0, "y": 0, "width": 1080, "height": 320,
                    "rotation": 0, "corner_radius": 0, "z_index": 0, "clip": False
                },
                "style": {"visible": True, "fill": "$tokens.colors.primary", "opacity": 1.0},
                "text": None, "text_runs": [], "image_src": None,
            },
            {
                "id": "logo",
                "kind": "image",
                "name": "brand logo",
                "parent_id": "bg",
                "children_ids": [],
                "geometry": {
                    "x": 60, "y": 80, "width": 160, "height": 160,
                    "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False
                },
                "style": {"visible": True, "fill": "#00000000", "opacity": 1.0, "image_fit": "fit"},
                "text": None, "text_runs": [],
                "image_src": "{{brand_logo_asset}}",
            },
            {
                "id": "title",
                "kind": "text",
                "name": "header title",
                "parent_id": "bg",
                "children_ids": [],
                "geometry": {
                    "x": 260, "y": 96, "width": 760, "height": 100,
                    "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False
                },
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0},
                "text": "{{title}}",
                "text_runs": [
                    {
                        "text": "{{title}}",
                        "style": "$tokens.fonts.headline",
                        "fill": "$tokens.colors.paper",
                    }
                ],
                "image_src": None,
            },
            {
                "id": "subtitle",
                "kind": "text",
                "name": "header subtitle",
                "parent_id": "bg",
                "children_ids": [],
                "geometry": {
                    "x": 260, "y": 208, "width": 760, "height": 48,
                    "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False
                },
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 0.85},
                "text": "{{subtitle}}",
                "text_runs": [
                    {
                        "text": "{{subtitle}}",
                        "style": "$tokens.fonts.body",
                        "fill": "$tokens.colors.paper",
                    }
                ],
                "image_src": None,
            },
        ],
    }


def contact_footer() -> Dict[str, Any]:
    """A 1080x160 footer with phone + city + whatsapp icon + pin icon.

    Props:
        phone:          phone number string
        city:           city / address line
        whatsapp_asset: icon path/url
        pin_asset:      pin icon path/url
    """
    return {
        "id": "contact_footer",
        "params": ["phone", "city", "whatsapp_asset", "pin_asset"],
        "defaults": {"city": "", "whatsapp_asset": "", "pin_asset": ""},
        "width": 1080,
        "height": 160,
        "nodes": [
            {
                "id": "bg",
                "kind": "rect", "name": "footer bg",
                "parent_id": None,
                "children_ids": ["wa_icon", "phone", "pin_icon", "city"],
                "geometry": {"x": 0, "y": 0, "width": 1080, "height": 160,
                             "rotation": 0, "corner_radius": 0, "z_index": 0, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.ink", "opacity": 1.0},
                "text": None, "text_runs": [], "image_src": None,
            },
            {
                "id": "wa_icon", "kind": "image", "name": "whatsapp icon",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 60, "y": 56, "width": 48, "height": 48,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "#00000000", "opacity": 1.0, "image_fit": "fit"},
                "text": None, "text_runs": [],
                "image_src": "{{whatsapp_asset}}",
            },
            {
                "id": "phone", "kind": "text", "name": "phone",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 124, "y": 60, "width": 380, "height": 44,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0},
                "text": "{{phone}}",
                "text_runs": [
                    {"text": "{{phone}}", "style": "$tokens.fonts.body", "fill": "$tokens.colors.paper"}
                ],
                "image_src": None,
            },
            {
                "id": "pin_icon", "kind": "image", "name": "pin icon",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 540, "y": 56, "width": 48, "height": 48,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "#00000000", "opacity": 1.0, "image_fit": "fit"},
                "text": None, "text_runs": [],
                "image_src": "{{pin_asset}}",
            },
            {
                "id": "city", "kind": "text", "name": "city",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 604, "y": 60, "width": 420, "height": 44,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0},
                "text": "{{city}}",
                "text_runs": [
                    {"text": "{{city}}", "style": "$tokens.fonts.body", "fill": "$tokens.colors.paper"}
                ],
                "image_src": None,
            },
        ],
    }


def disclaimer_block() -> Dict[str, Any]:
    """A 1080x80 small-print disclaimer line.

    Props:
        text: disclaimer copy
    """
    return {
        "id": "disclaimer_block",
        "params": ["text"],
        "defaults": {"text": ""},
        "width": 1080,
        "height": 80,
        "nodes": [
            {
                "id": "label",
                "kind": "text", "name": "disclaimer",
                "parent_id": None, "children_ids": [],
                "geometry": {"x": 60, "y": 20, "width": 960, "height": 40,
                             "rotation": 0, "corner_radius": 0, "z_index": 0, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.ink", "opacity": 0.65},
                "text": "{{text}}",
                "text_runs": [
                    {"text": "{{text}}", "style": "$tokens.fonts.caption",
                     "fill": "$tokens.colors.ink"}
                ],
                "image_src": None,
            }
        ],
    }


def corner_brackets() -> Dict[str, Any]:
    """4 L-shaped corner brackets covering a 600x400 frame.

    Inset is fixed in the definition; scale by setting the instance geometry
    to match the frame you want the brackets to wrap around. The brackets
    grow proportionally because the expander applies the scale factor.

    Props (informational; brackets are positionally driven by instance geo):
        color:  bracket color (consumed via token in style)
        weight: visual weight (informational)
    """
    arm = 60      # arm length px in definition coords
    weight = 4    # arm thickness
    W, H = 600, 400
    color_ref = "$tokens.colors.primary"

    def rect(rid: str, name: str, x: float, y: float, w: float, h: float) -> Dict[str, Any]:
        return {
            "id": rid, "kind": "rect", "name": name,
            "parent_id": None, "children_ids": [],
            "geometry": {"x": x, "y": y, "width": w, "height": h,
                         "rotation": 0, "corner_radius": weight / 2.0,
                         "z_index": 0, "clip": False},
            "style": {"visible": True, "fill": color_ref, "opacity": 1.0},
            "text": None, "text_runs": [], "image_src": None,
        }

    return {
        "id": "corner_brackets",
        "params": ["color", "weight"],
        "defaults": {"color": "$tokens.colors.primary", "weight": 4},
        "width": W,
        "height": H,
        "nodes": [
            rect("tl_h", "tl horizontal", 0, 0, arm, weight),
            rect("tl_v", "tl vertical", 0, 0, weight, arm),
            rect("tr_h", "tr horizontal", W - arm, 0, arm, weight),
            rect("tr_v", "tr vertical", W - weight, 0, weight, arm),
            rect("bl_h", "bl horizontal", 0, H - weight, arm, weight),
            rect("bl_v", "bl vertical", 0, H - arm, weight, arm),
            rect("br_h", "br horizontal", W - arm, H - weight, arm, weight),
            rect("br_v", "br vertical", W - weight, H - arm, weight, arm),
        ],
    }


def metallic_band() -> Dict[str, Any]:
    """A horizontal band styled as a brushed metal gradient.

    Authoring viewport is 1080x40; scale by setting the instance geometry.
    Uses the ``metallic`` macro via the ``_macros`` field so the doc_macros
    pipeline renders the brushed gradient at render time.

    Props:
        colors: 2-3 hex strings (consumed by metallic macro on the rect)
    """
    return {
        "id": "metallic_band",
        "params": ["colors"],
        "defaults": {"colors": ["#B8893F", "#F5D88A", "#8E6A2F"]},
        "width": 1080,
        "height": 40,
        "nodes": [
            {
                "id": "band",
                "kind": "rect", "name": "metallic band",
                "parent_id": None, "children_ids": [],
                "geometry": {"x": 0, "y": 0, "width": 1080, "height": 40,
                             "rotation": 0, "corner_radius": 0, "z_index": 0, "clip": False},
                "style": {"visible": True, "fill": "#B8893F", "opacity": 1.0},
                "text": None, "text_runs": [], "image_src": None,
                "_macros": {
                    "metallic": {
                        "colors": ["#B8893F", "#F5D88A", "#8E6A2F"],
                        "direction": "horizontal",
                        "noise": 0.08,
                    }
                },
            }
        ],
    }


def cta_button() -> Dict[str, Any]:
    """A 320x80 rounded button with a label.

    Props:
        label: button copy (e.g. "BOOK")
    """
    return {
        "id": "cta_button",
        "params": ["label"],
        "defaults": {"label": "BOOK"},
        "width": 320,
        "height": 80,
        "nodes": [
            {
                "id": "bg", "kind": "rect", "name": "cta bg",
                "parent_id": None, "children_ids": ["label"],
                "geometry": {"x": 0, "y": 0, "width": 320, "height": 80,
                             "rotation": 0, "corner_radius": 40, "z_index": 0, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.primary", "opacity": 1.0},
                "text": None, "text_runs": [], "image_src": None,
            },
            {
                "id": "label", "kind": "text", "name": "cta label",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 0, "y": 18, "width": 320, "height": 44,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0},
                "text": "{{label}}",
                "text_runs": [
                    {"text": "{{label}}", "style": "$tokens.fonts.body",
                     "fill": "$tokens.colors.paper", "text_align": "center"}
                ],
                "image_src": None,
            },
        ],
    }


def info_chip() -> Dict[str, Any]:
    """A 240x56 pill with an icon + short label, for badges/tags.

    Props:
        icon_asset: path/url to the icon
        label:      chip copy
    """
    return {
        "id": "info_chip",
        "params": ["icon_asset", "label"],
        "defaults": {"icon_asset": "", "label": ""},
        "width": 240,
        "height": 56,
        "nodes": [
            {
                "id": "bg", "kind": "rect", "name": "chip bg",
                "parent_id": None, "children_ids": ["icon", "label"],
                "geometry": {"x": 0, "y": 0, "width": 240, "height": 56,
                             "rotation": 0, "corner_radius": 28, "z_index": 0, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.paper", "opacity": 1.0,
                          "stroke": {"color": "$tokens.colors.primary", "width": 2}},
                "text": None, "text_runs": [], "image_src": None,
            },
            {
                "id": "icon", "kind": "image", "name": "chip icon",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 12, "y": 12, "width": 32, "height": 32,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "#00000000", "opacity": 1.0, "image_fit": "fit"},
                "text": None, "text_runs": [],
                "image_src": "{{icon_asset}}",
            },
            {
                "id": "label", "kind": "text", "name": "chip label",
                "parent_id": "bg", "children_ids": [],
                "geometry": {"x": 52, "y": 14, "width": 176, "height": 28,
                             "rotation": 0, "corner_radius": 0, "z_index": 1, "clip": False},
                "style": {"visible": True, "fill": "$tokens.colors.ink", "opacity": 1.0},
                "text": "{{label}}",
                "text_runs": [
                    {"text": "{{label}}", "style": "$tokens.fonts.body", "fill": "$tokens.colors.ink"}
                ],
                "image_src": None,
            },
        ],
    }


# --------------------------------------------------------------------------- #
# Registry + injection helper.
# --------------------------------------------------------------------------- #


_BUILDERS = [
    price_card,
    title_header,
    contact_footer,
    disclaimer_block,
    corner_brackets,
    metallic_band,
    cta_button,
    info_chip,
]


def _build_registry() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for builder in _BUILDERS:
        defn = builder()
        out[defn["id"]] = defn
    return out


BUILTIN_COMPONENTS: Dict[str, Dict[str, Any]] = _build_registry()


def list_builtin_components() -> List[Dict[str, Any]]:
    """Lightweight summary for the CLI / docs."""
    return [
        {
            "id": d["id"],
            "params": list(d.get("params") or []),
            "defaults": dict(d.get("defaults") or {}),
            "width": d.get("width"),
            "height": d.get("height"),
        }
        for d in BUILTIN_COMPONENTS.values()
    ]


def inject_builtins(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Append every built-in definition to ``doc.metadata.components.definitions``.

    Existing user-defined definitions take precedence: built-ins are appended
    only if no definition with the same id is already present.
    """
    if not isinstance(doc, dict):
        raise TypeError("inject_builtins expects a dict")
    out = copy.deepcopy(doc)
    meta = out.setdefault("metadata", {})
    if not isinstance(meta, dict):
        out["metadata"] = meta = {}
    comp_root = meta.setdefault("components", {})
    if not isinstance(comp_root, dict):
        meta["components"] = comp_root = {}
    defs = comp_root.setdefault("definitions", [])
    if not isinstance(defs, list):
        comp_root["definitions"] = defs = []
    existing_ids = {d.get("id") for d in defs if isinstance(d, dict)}
    for cid, defn in BUILTIN_COMPONENTS.items():
        if cid in existing_ids:
            continue
        defs.append(copy.deepcopy(defn))
    return out


__all__ = [
    "BUILTIN_COMPONENTS",
    "inject_builtins",
    "list_builtin_components",
]
