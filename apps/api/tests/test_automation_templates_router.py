from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import automation_templates as automation_templates_router


def _read_store(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_update_automation_template_preserves_integrations_and_id(tmp_path: Path, monkeypatch: Any) -> None:
    root = tmp_path / "automation_templates"
    root.mkdir(parents=True, exist_ok=True)
    store_path = root / "test_example.com.json"
    store_path.write_text(
        json.dumps(
            {
                "version": 1,
                "items": [
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "name": "Template original",
                        "project_key": "proj_a",
                        "source_page_name": "Page 1",
                        "created_at": "2026-04-01T10:00:00+00:00",
                        "updated_at": "2026-04-01T10:00:00+00:00",
                        "doc_json": {
                            "version": 1,
                            "root_id": "root",
                            "canvas": {"width": 1080, "height": 1080, "background": "#ffffff"},
                            "nodes": [
                                {
                                    "id": "root",
                                    "name": "Root",
                                    "kind": "frame",
                                    "children_ids": ["title"],
                                    "geometry": {"x": 0, "y": 0, "width": 1080, "height": 1080, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0, "transform_matrix": None},
                                    "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                                    "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                                    "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                                    "text": None,
                                    "text_style": {"family": None, "postscript": None, "style": None, "size": None, "line_height": None, "line_height_unit": "percent", "letter_spacing": None, "text_align": "left", "vertical_align": "top", "color": None},
                                    "text_runs": [],
                                    "text_path": None,
                                    "image_src": None,
                                    "editable": False,
                                    "component_instance": None,
                                },
                                {
                                    "id": "title",
                                    "name": "TITLE",
                                    "kind": "text",
                                    "children_ids": [],
                                    "geometry": {"x": 20, "y": 20, "width": 240, "height": 60, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1, "transform_matrix": None},
                                    "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                                    "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                                    "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                                    "text": "Old",
                                    "text_style": {"family": "Arial", "postscript": "ArialMT", "style": "Regular", "size": 48, "line_height": 120, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top", "color": "#111111"},
                                    "text_runs": [],
                                    "text_path": None,
                                    "image_src": None,
                                    "editable": False,
                                    "component_instance": None,
                                },
                            ],
                            "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
                            "dynamic_rules": [],
                            "metadata": {"source": "test"},
                        },
                        "bindings": [{"id": "title", "layer_name": "TITLE", "kind": "text"}],
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(automation_templates_router, "_storage_root", lambda: root)

    req = automation_templates_router.UpdateAutomationTemplateRequest(
        name="Updated template",
        project_key="proj_b",
        source_page_name="Page 2",
        doc_json={
            "version": 1,
            "root_id": "root",
            "canvas": {"width": 1080, "height": 1080, "background": "#ffffff"},
            "nodes": [
                {
                    "id": "root",
                    "name": "Root",
                    "kind": "frame",
                    "children_ids": ["title", "subtitle"],
                    "geometry": {"x": 0, "y": 0, "width": 1080, "height": 1080, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0, "transform_matrix": None},
                    "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                    "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                    "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                    "text": None,
                    "text_style": {"family": None, "postscript": None, "style": None, "size": None, "line_height": None, "line_height_unit": "percent", "letter_spacing": None, "text_align": "left", "vertical_align": "top", "color": None},
                    "text_runs": [],
                    "text_path": None,
                    "image_src": None,
                    "editable": False,
                    "component_instance": None,
                },
                {
                    "id": "title",
                    "name": "TITLE",
                    "kind": "text",
                    "children_ids": [],
                    "geometry": {"x": 20, "y": 20, "width": 240, "height": 60, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 2, "transform_matrix": None},
                    "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                    "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                    "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                    "text": "New",
                    "text_style": {"family": "Arial", "postscript": "ArialMT", "style": "Regular", "size": 48, "line_height": 120, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top", "color": "#111111"},
                    "text_runs": [],
                    "text_path": None,
                    "image_src": None,
                    "editable": False,
                    "component_instance": None,
                },
                {
                    "id": "subtitle",
                    "name": "SUBTITLE",
                    "kind": "text",
                    "children_ids": [],
                    "geometry": {"x": 20, "y": 96, "width": 280, "height": 44, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1, "transform_matrix": None},
                    "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                    "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                    "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                    "text": "Support",
                    "text_style": {"family": "Arial", "postscript": "ArialMT", "style": "Regular", "size": 28, "line_height": 120, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top", "color": "#111111"},
                    "text_runs": [],
                    "text_path": None,
                    "image_src": None,
                    "editable": False,
                    "component_instance": None,
                },
            ],
            "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
            "dynamic_rules": [],
            "metadata": {"source": "test"},
        },
        bindings=[
            automation_templates_router.AutomationBindingModel(id="title", layer_name="TITLE", kind="text"),
            automation_templates_router.AutomationBindingModel(id="subtitle", layer_name="SUBTITLE", kind="text"),
        ],
    )

    out = automation_templates_router.update_automation_template(
        "11111111-1111-4111-8111-111111111111",
        req,
        principal=SimpleNamespace(username="test@example.com"),
    )

    assert out["ok"] is True
    assert out["template"]["id"] == "11111111-1111-4111-8111-111111111111"
    assert out["template"]["name"] == "Updated template"
    assert out["template"]["binding_count"] == 2

    store = _read_store(store_path)
    saved = store["items"][0]
    assert saved["id"] == "11111111-1111-4111-8111-111111111111"
    assert saved["name"] == "Updated template"
    assert saved["project_key"] == "proj_b"
    assert saved["source_page_name"] == "Page 2"
    assert saved["created_at"] == "2026-04-01T10:00:00+00:00"
    assert saved["updated_at"] != "2026-04-01T10:00:00+00:00"
    assert [binding["id"] for binding in saved["bindings"]] == ["title", "subtitle"]
    assert saved["doc_json"]["nodes"][2]["id"] == "subtitle"

