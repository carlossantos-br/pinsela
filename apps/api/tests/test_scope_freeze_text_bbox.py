from __future__ import annotations

import copy
import os

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com,other@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import templates


def test_image_ref_normalization_does_not_change_text_or_geometry_fields() -> None:
    doc = {
        "version": 1,
        "canvas": {"width": 1080, "height": 1080, "background": "#fff"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["txt", "img"],
                "name": "Root",
                "kind": "frame",
                "geometry": {"x": 0, "y": 0, "width": 1080, "height": 1080, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "style": "Regular", "size": 28, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "editable": False,
            },
            {
                "id": "txt",
                "parent_id": "root",
                "children_ids": [],
                "name": "Title",
                "kind": "text",
                "geometry": {"x": 100, "y": 120, "width": 600, "height": 100, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": "#111", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": "Original title",
                "text_style": {"family": "Inter", "style": "Medium", "size": 42, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "editable": True,
            },
            {
                "id": "img",
                "parent_id": "root",
                "children_ids": [],
                "name": "Hero",
                "kind": "image",
                "geometry": {"x": 120, "y": 300, "width": 420, "height": 420, "rotation": 0, "corner_radius": 20, "clip": True, "z_index": 2},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "style": "Regular", "size": 42, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "image_asset_id": "11111111-1111-4111-8111-111111111111",
                "editable": True,
            },
        ],
        "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
        "dynamic_rules": [],
        "metadata": {"source": "scope-freeze"},
    }
    before = copy.deepcopy(doc)
    out = templates._normalize_doc_image_refs(doc)

    assert out["nodes"][1]["text"] == before["nodes"][1]["text"]
    assert out["nodes"][1]["text_style"] == before["nodes"][1]["text_style"]
    assert out["nodes"][1]["geometry"] == before["nodes"][1]["geometry"]
    assert out["nodes"][0]["geometry"] == before["nodes"][0]["geometry"]
    assert out["nodes"][2]["image_src"] == "/api/assets/11111111-1111-4111-8111-111111111111"
