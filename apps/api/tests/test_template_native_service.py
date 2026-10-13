from __future__ import annotations

import os

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.services.template_native import (  # noqa: E402
    build_mapping_from_native_doc,
    build_schema_from_native_doc,
    validate_native_doc,
)


def _sample_doc() -> dict:
    return {
        "version": 1,
        "template_kind": "folder",
        "canvas": {"width": 1080, "height": 1080, "background": "#f2ece4"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["title_1", "hero_1"],
                "name": "ROOT",
                "kind": "frame",
                "geometry": {
                    "x": 0,
                    "y": 0,
                    "width": 1080,
                    "height": 1080,
                    "rotation": 0,
                    "corner_radius": 0,
                    "clip": False,
                    "z_index": 0,
                },
                "layout": {
                    "direction": "none",
                    "gap": 0,
                    "padding_top": 0,
                    "padding_right": 0,
                    "padding_bottom": 0,
                    "padding_left": 0,
                    "align_main": "start",
                    "align_cross": "start",
                    "sizing_mode": "fixed",
                    "wrap": False,
                },
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {
                    "visible": True,
                    "opacity": 1,
                    "blend_mode": "normal",
                    "fill": "#f2ece4",
                    "stroke": None,
                    "effects": [],
                    "image_fit": "fill",
                    "image_crop": None,
                    "mask": False,
                },
                "text": None,
                "text_style": {
                    "family": "Inter",
                    "postscript": "Inter-Regular",
                    "style": "Regular",
                    "size": 42,
                    "line_height": 110,
                    "line_height_unit": "percent",
                    "letter_spacing": 0,
                    "text_align": "left",
                    "vertical_align": "top",
                },
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
            },
            {
                "id": "title_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "Title1",
                "kind": "text",
                "geometry": {
                    "x": 120,
                    "y": 120,
                    "width": 840,
                    "height": 100,
                    "rotation": 0,
                    "corner_radius": 0,
                    "clip": False,
                    "z_index": 1,
                },
                "layout": {
                    "direction": "none",
                    "gap": 0,
                    "padding_top": 0,
                    "padding_right": 0,
                    "padding_bottom": 0,
                    "padding_left": 0,
                    "align_main": "start",
                    "align_cross": "start",
                    "sizing_mode": "fixed",
                    "wrap": False,
                },
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {
                    "visible": True,
                    "opacity": 1,
                    "blend_mode": "normal",
                    "fill": "#111111",
                    "stroke": None,
                    "effects": [],
                    "image_fit": "fill",
                    "image_crop": None,
                    "mask": False,
                },
                "text": "",
                "text_style": {
                    "family": "Inter",
                    "postscript": "Inter-Medium",
                    "style": "Medium",
                    "size": 42,
                    "line_height": 110,
                    "line_height_unit": "percent",
                    "letter_spacing": 0,
                    "text_align": "left",
                    "vertical_align": "top",
                },
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": True,
            },
            {
                "id": "hero_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "Hero",
                "kind": "image",
                "geometry": {
                    "x": 120,
                    "y": 300,
                    "width": 420,
                    "height": 420,
                    "rotation": 0,
                    "corner_radius": 20,
                    "clip": True,
                    "z_index": 2,
                },
                "layout": {
                    "direction": "none",
                    "gap": 0,
                    "padding_top": 0,
                    "padding_right": 0,
                    "padding_bottom": 0,
                    "padding_left": 0,
                    "align_main": "start",
                    "align_cross": "start",
                    "sizing_mode": "fixed",
                    "wrap": False,
                },
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {
                    "visible": True,
                    "opacity": 1,
                    "blend_mode": "normal",
                    "fill": None,
                    "stroke": None,
                    "effects": [],
                    "image_fit": "fill",
                    "image_crop": None,
                    "mask": False,
                },
                "text": None,
                "text_style": {
                    "family": "Inter",
                    "postscript": "Inter-Regular",
                    "style": "Regular",
                    "size": 42,
                    "line_height": 110,
                    "line_height_unit": "percent",
                    "letter_spacing": 0,
                    "text_align": "left",
                    "vertical_align": "top",
                },
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": True,
            },
        ],
        "bindings": {
            "text": {
                "title1": {
                    "node_id": "title_1",
                    "required": True,
                    "label": "Title 1",
                    "fit": {
                        "start_size": 42,
                        "min_size": 35,
                        "max_lines": 2,
                        "min_lines": 1,
                        "truncate_mode": "none",
                    },
                    "font": {
                        "family": "Inter",
                        "postscript": "Inter-Medium",
                        "style": "Medium",
                    },
                }
            },
            "images_single": {
                "hero_image": {
                    "node_id": "hero_1",
                    "required": False,
                    "label": "Hero",
                }
            },
            "images_array": {},
            "product_frames": None,
        },
        "dynamic_rules": [],
        "metadata": {"source": "unit-test"},
    }


def test_validate_native_doc_accepts_valid_shape() -> None:
    out = validate_native_doc(_sample_doc())
    assert out["version"] == 1
    assert out["root_id"] == "root"
    assert isinstance(out["nodes"], list) and len(out["nodes"]) == 3


def test_build_schema_from_native_doc_maps_bindings() -> None:
    doc = _sample_doc()
    schema = build_schema_from_native_doc(doc)
    assert schema["version"] == 2
    assert "title1" in schema["fields"]
    assert "hero_image" in schema["fields"]
    assert schema["fields"]["title1"]["ui"]["widget"] in ("text", "textarea")


def test_build_mapping_from_native_doc_contains_native_markers() -> None:
    doc = _sample_doc()
    mapping = build_mapping_from_native_doc(doc)
    assert mapping["engine_type"] == "pinsela_native_v1"
    assert mapping["template_kind"] == "folder"
    assert mapping["text_nodes"]["title1"]["value"] == "title_1"
    assert mapping["hero_image"]["value"] == "hero_1"


def test_validate_native_doc_accepts_components_metadata_and_instances() -> None:
    doc = _sample_doc()
    doc["metadata"] = {
        "source": "unit-test",
        "components": {
            "definitions": [
                {
                    "id": "cmp_card",
                    "name": "Card",
                    "source_node_ids": ["title_1", "hero_1"],
                }
            ]
        },
    }
    for node in doc["nodes"]:
        if node["id"] == "hero_1":
            node["component_instance"] = {
                "component_id": "cmp_card",
                "source_node_id": "hero_1",
                "override_keys": ["style", "geometry"],
            }
    out = validate_native_doc(doc)
    assert out["metadata"]["components"]["definitions"][0]["id"] == "cmp_card"
    hero = [n for n in out["nodes"] if n["id"] == "hero_1"][0]
    assert hero["component_instance"]["component_id"] == "cmp_card"


def test_validate_native_doc_preserves_editor_extended_fields() -> None:
    doc = _sample_doc()
    root = doc["nodes"][0]
    root["children_ids"].append("path_1")

    title = doc["nodes"][1]
    title["layout"]["wrap_mode"] = "grid"
    title["layout"]["grid_columns"] = 3
    title["layout"]["grid_rows"] = 2
    title["style"]["strokes"] = [
        {
            "id": "stroke_1",
            "enabled": True,
            "visible": True,
            "color": "#8f6645",
            "weight": 3,
            "align": "outside",
        }
    ]
    title["style"]["image_duotone"] = {"enabled": True}
    title["style"]["image_brush_settings"] = {"size": 12}
    title["style"]["image_brush_strokes"] = [{"id": "brush_1", "points": []}]
    title["style"]["custom_effect"] = {"foo": "bar"}
    title["text_style"]["underline"] = True
    title["text_style"]["baseline_shift"] = 1.5
    title["text_style"]["line_height_scale"] = 1.1

    doc["nodes"].append(
        {
            "id": "path_1",
            "parent_id": "root",
            "children_ids": [],
            "name": "Path1",
            "kind": "path",
            "geometry": {
                "x": 10,
                "y": 10,
                "width": 40,
                "height": 40,
                "rotation": 0,
                "corner_radius": 0,
                "clip": False,
                "z_index": 3,
            },
            "layout": {
                "direction": "none",
                "gap": 0,
                "padding_top": 0,
                "padding_right": 0,
                "padding_bottom": 0,
                "padding_left": 0,
                "align_main": "start",
                "align_cross": "start",
                "sizing_mode": "fixed",
                "wrap": False,
            },
            "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
            "style": {
                "visible": True,
                "opacity": 1,
                "blend_mode": "normal",
                "fill": "#222222",
                "stroke": {"color": "#111111", "width": 2},
                "effects": [],
                "image_fit": "fill",
                "image_crop": None,
                "mask": False,
            },
            "text": None,
            "text_style": {
                "family": "Inter",
                "postscript": "Inter-Regular",
                "style": "Regular",
                "size": 12,
                "line_height": 110,
                "line_height_unit": "percent",
                "letter_spacing": 0,
                "text_align": "left",
                "vertical_align": "top",
            },
            "text_runs": [],
            "text_path": None,
            "path_data": {
                "closed": True,
                "points": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}],
            },
            "image_src": None,
            "editable": False,
        }
    )

    out = validate_native_doc(doc)
    title_out = [n for n in out["nodes"] if n["id"] == "title_1"][0]
    assert title_out["layout"]["wrap_mode"] == "grid"
    assert title_out["layout"]["grid_columns"] == 3
    assert title_out["layout"]["grid_rows"] == 2
    assert isinstance(title_out["style"]["strokes"], list) and title_out["style"]["strokes"][0]["id"] == "stroke_1"
    assert title_out["style"]["image_duotone"]["enabled"] is True
    assert title_out["style"]["image_brush_settings"]["size"] == 12
    assert title_out["style"]["image_brush_strokes"][0]["id"] == "brush_1"
    assert title_out["style"]["custom_effect"]["foo"] == "bar"
    assert title_out["text_style"]["underline"] is True
    assert title_out["text_style"]["baseline_shift"] == 1.5
    assert title_out["text_style"]["line_height_scale"] == 1.1
    path_out = [n for n in out["nodes"] if n["id"] == "path_1"][0]
    assert path_out["kind"] == "path"
    assert path_out["path_data"]["closed"] is True
