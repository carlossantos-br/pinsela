from __future__ import annotations

import io

from PIL import Image, ImageDraw

import pinsela.services.render_engine_native as native_engine
from pinsela.services.render_engine_native import _pick_font, render_native_template, simulate_native_layout


def _doc() -> dict:
    return {
        "version": 1,
        "template_kind": "folder",
        "canvas": {"width": 900, "height": 900, "background": "#f2ece4"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["title_1", "body_1", "frame_1", "frame_2", "frame_3"],
                "name": "ROOT",
                "kind": "frame",
                "geometry": {"x": 0, "y": 0, "width": 900, "height": 900, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#f2ece4", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 32, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
            {
                "id": "title_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "title1",
                "kind": "text",
                "geometry": {"x": 80, "y": 70, "width": 740, "height": 100, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#111111", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": "",
                "text_style": {"family": "Inter", "postscript": "Inter-Medium", "style": "Medium", "size": 40, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top", "color": "#111111"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": True,
            },
            {
                "id": "body_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "body1",
                "kind": "text",
                "geometry": {"x": 80, "y": 180, "width": 740, "height": 130, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 2},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#111111", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": "",
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 35, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top", "color": "#111111"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": True,
            },
            {
                "id": "frame_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "produto1",
                "kind": "rect",
                "geometry": {"x": 80, "y": 340, "width": 740, "height": 80, "rotation": 0, "corner_radius": 28, "clip": False, "z_index": 3},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#d8c0a8", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 24, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
            {
                "id": "frame_2",
                "parent_id": "root",
                "children_ids": [],
                "name": "produto2",
                "kind": "rect",
                "geometry": {"x": 80, "y": 432, "width": 740, "height": 80, "rotation": 0, "corner_radius": 28, "clip": False, "z_index": 4},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#d8c0a8", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 24, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
            {
                "id": "frame_3",
                "parent_id": "root",
                "children_ids": [],
                "name": "produto3",
                "kind": "rect",
                "geometry": {"x": 80, "y": 524, "width": 740, "height": 80, "rotation": 0, "corner_radius": 28, "clip": False, "z_index": 5},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#d8c0a8", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 24, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
        ],
        "bindings": {
            "text": {
                "title1": {"node_id": "title_1", "required": True, "fit": {"start_size": 40, "min_size": 35, "max_lines": 2, "truncate_mode": "none"}, "font": {"family": "Inter", "style": "Medium", "postscript": "Inter-Medium"}},
                "body1": {"node_id": "body_1", "required": True, "fit": {"start_size": 35, "min_size": 30, "max_lines": 2, "truncate_mode": "none"}, "font": {"family": "Inter", "style": "Regular", "postscript": "Inter-Regular"}},
            },
            "images_single": {},
            "images_array": {},
            "product_frames": {"node_ids": ["frame_1", "frame_2", "frame_3"], "hide_empty": True},
        },
        "dynamic_rules": [{"id": "r1", "type": "product_visibility_reflow", "container_id": "root", "item_ids": ["frame_1", "frame_2", "frame_3"], "gap": 12, "align": "center", "preserve_order": True}],
        "metadata": {"source": "unit-test"},
    }


def _stroke_doc(stroke: dict) -> dict:
    return {
        "version": 1,
        "template_kind": "stroke-test",
        "canvas": {"width": 240, "height": 200, "background": "#ffffff"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["r1"],
                "name": "ROOT",
                "kind": "frame",
                "geometry": {"x": 0, "y": 0, "width": 240, "height": 200, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#ffffff", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 16, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
            {
                "id": "r1",
                "parent_id": "root",
                "children_ids": [],
                "name": "rect",
                "kind": "rect",
                "geometry": {"x": 60, "y": 40, "width": 100, "height": 100, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "transparent", "stroke": stroke, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 16, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
        ],
        "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
        "dynamic_rules": [],
        "metadata": {"source": "unit-test"},
    }


def test_native_renderer_generates_png_and_jpg() -> None:
    doc = _doc()
    payload = {
        "title1": "Special house coffee",
        "body1": "Selected beans, medium roast and chocolate notes to start the day right.",
        "product_count": 1,
    }

    rendered = render_native_template(doc, payload)
    assert "png" in rendered and "jpg" in rendered

    png_bytes, png_meta = rendered["png"]
    jpg_bytes, jpg_meta = rendered["jpg"]

    assert len(png_bytes) > 1000
    assert len(jpg_bytes) > 1000
    assert png_meta["width"] == 900 and png_meta["height"] == 900
    assert jpg_meta["width"] == 900 and jpg_meta["height"] == 900
    assert isinstance(png_meta.get("sha256"), str) and len(png_meta["sha256"]) == 64
    assert isinstance(jpg_meta.get("sha256"), str) and len(jpg_meta["sha256"]) == 64


def test_native_renderer_supports_transparent_background_mode() -> None:
    doc = _doc()
    payload = {"title1": "A", "body1": "B", "product_count": 0}

    rendered = render_native_template(doc, payload, background_mode="transparent")
    png_bytes, _png_meta = rendered["png"]
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")

    # Top-left is outside drawn nodes and should keep transparent page background.
    assert img.getpixel((0, 0))[3] == 0


def test_simulate_native_layout_supports_horizontal_reflow() -> None:
    doc = _doc()
    doc["dynamic_rules"] = [
        {
            "id": "r1",
            "type": "product_visibility_reflow",
            "container_id": "root",
            "item_ids": ["frame_1", "frame_2", "frame_3"],
            "gap": 12,
            "align": "start",
            "preserve_order": True,
            "reflow_direction": "horizontal",
            "collapse_spacing_when_hidden": True,
            "recenter_on_children_visible": True,
        }
    ]
    simulated = simulate_native_layout(doc, {"product_count": 3})
    nodes = {str(n.get("id")): n for n in simulated.get("nodes") or []}
    x1 = float((nodes["frame_1"].get("geometry") or {}).get("x", 0))
    x2 = float((nodes["frame_2"].get("geometry") or {}).get("x", 0))
    x3 = float((nodes["frame_3"].get("geometry") or {}).get("x", 0))
    assert x1 < x2 < x3


def test_simulate_native_layout_hide_when_empty() -> None:
    doc = _doc()
    doc["dynamic_rules"] = [
        {
            "id": "hide-1",
            "type": "hide_when_empty",
            "item_ids": ["body_1"],
            "binding_key": "body1",
        }
    ]
    simulated = simulate_native_layout(doc, {"body1": ""})
    nodes = {str(n.get("id")): n for n in simulated.get("nodes") or []}
    style = nodes["body_1"].get("style") if isinstance(nodes["body_1"].get("style"), dict) else {}
    assert style.get("visible") is False


def test_stroke_outside_is_clipped_to_outside_half_width() -> None:
    doc = _stroke_doc(
        {
            "color": "#ff0000",
            "width": 10,
            "align": "outside",
            "mode": "basic",
            "width_profile": "uniform",
            "sides": {"top": True, "right": True, "bottom": True, "left": True},
        }
    )
    rendered = render_native_template(doc, {}, background_mode="transparent")
    img = Image.open(io.BytesIO(rendered["png"][0])).convert("RGBA")

    y = 90
    row = [img.getpixel((x, y))[3] for x in range(img.width)]

    assert all(row[x] > 0 for x in range(55, 60))
    assert all(row[x] == 0 for x in range(60, 66))
    assert all(row[x] > 0 for x in range(161, 166))
    assert row[54] == 0 and row[166] == 0


def test_stroke_width_profile_changes_rendered_weight() -> None:
    base = {
        "color": "#ff0000",
        "width": 10,
        "align": "outside",
        "mode": "basic",
        "sides": {"top": True, "right": True, "bottom": True, "left": True},
    }
    doc_uniform = _stroke_doc({**base, "width_profile": "uniform"})
    doc_taper = _stroke_doc({**base, "width_profile": "taper_both"})

    img_uniform = Image.open(io.BytesIO(render_native_template(doc_uniform, {}, background_mode="transparent")["png"][0])).convert("RGBA")
    img_taper = Image.open(io.BytesIO(render_native_template(doc_taper, {}, background_mode="transparent")["png"][0])).convert("RGBA")

    y = 90
    count_uniform = sum(1 for x in range(img_uniform.width) if img_uniform.getpixel((x, y))[3] > 0)
    count_taper = sum(1 for x in range(img_taper.width) if img_taper.getpixel((x, y))[3] > 0)

    assert count_taper < count_uniform


def test_renderer_uses_strokes_stack_when_primary_stroke_is_missing() -> None:
    doc = _stroke_doc(None)
    rect = next(n for n in doc["nodes"] if n["id"] == "r1")
    rect["style"]["strokes"] = [
        {
            "id": "stroke_stack_1",
            "enabled": True,
            "visible": True,
            "color": "#ff0000",
            "weight": 10,
            "align": "outside",
            "mode": "basic",
            "width_profile": "uniform",
            "sides": {"top": True, "right": True, "bottom": True, "left": True},
        }
    ]

    rendered = render_native_template(doc, {}, background_mode="transparent")
    img = Image.open(io.BytesIO(rendered["png"][0])).convert("RGBA")
    y = 90
    row = [img.getpixel((x, y))[3] for x in range(img.width)]

    assert all(row[x] > 0 for x in range(55, 60))
    assert all(row[x] == 0 for x in range(60, 66))
    assert all(row[x] > 0 for x in range(161, 166))


def test_pick_font_fallback_respects_requested_size() -> None:
    small = _pick_font(
        family="__missing_family__",
        style="__missing_style__",
        postscript="__missing_postscript__",
        size=12,
    )
    big = _pick_font(
        family="__missing_family__",
        style="__missing_style__",
        postscript="__missing_postscript__",
        size=72,
    )
    canvas = Image.new("RGBA", (500, 200), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    bbox_small = draw.textbbox((0, 0), "TESTE", font=small)
    bbox_big = draw.textbbox((0, 0), "TESTE", font=big)
    h_small = bbox_small[3] - bbox_small[1]
    h_big = bbox_big[3] - bbox_big[1]
    assert h_big > h_small


def test_renderer_falls_back_to_image_asset_id_when_image_src_path_resolution_fails(monkeypatch) -> None:
    asset_id = "11111111-2222-3333-4444-555555555555"
    doc = {
        "version": 1,
        "template_kind": "image-fallback-test",
        "canvas": {"width": 40, "height": 40, "background": "transparent"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["img_1"],
                "name": "ROOT",
                "kind": "frame",
                "geometry": {"x": 0, "y": 0, "width": 40, "height": 40, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "transparent", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
            {
                "id": "img_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "logo",
                "kind": "image",
                "geometry": {"x": 5, "y": 5, "width": 30, "height": 30, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "transparent", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {},
                "text_runs": [],
                "text_path": None,
                "image_src": f"/api/assets/{asset_id}",
                "image_asset_id": asset_id,
                "editable": False,
            },
        ],
        "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
        "dynamic_rules": [],
        "metadata": {"source": "unit-test"},
    }

    preview = io.BytesIO()
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(preview, format="PNG")
    image_bytes = preview.getvalue()

    seen_refs: list[str] = []

    def _fake_extract_image_bytes(ref, *, db=None):
        s = "" if ref is None else str(ref)
        seen_refs.append(s)
        if s.startswith("/api/assets/"):
            return None
        if s == asset_id:
            return image_bytes
        return None

    monkeypatch.setattr(native_engine, "_extract_image_bytes", _fake_extract_image_bytes)

    rendered = render_native_template(doc, {}, background_mode="transparent")
    img = Image.open(io.BytesIO(rendered["png"][0])).convert("RGBA")

    assert img.getpixel((20, 20))[0:3] == (255, 0, 0)
    assert img.getpixel((20, 20))[3] > 0
    assert f"/api/assets/{asset_id}" in seen_refs
    assert asset_id in seen_refs
