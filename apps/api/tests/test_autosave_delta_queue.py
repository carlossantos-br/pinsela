from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com,other@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import templates
from pinsela.services import draft_pack_queue


def _doc() -> dict:
    return {
        "version": 1,
        "canvas": {"width": 1080, "height": 1080, "background": "#fff"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["img"],
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
                "id": "img",
                "parent_id": "root",
                "children_ids": [],
                "name": "Hero",
                "kind": "image",
                "geometry": {"x": 120, "y": 300, "width": 420, "height": 420, "rotation": 0, "corner_radius": 20, "clip": True, "z_index": 1},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "opacity": 1, "blend_mode": "normal", "fill": None, "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "style": "Regular", "size": 42, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_asset_id": "11111111-1111-4111-8111-111111111111",
                "image_src": None,
                "editable": True,
            },
        ],
        "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
        "dynamic_rules": [],
        "metadata": {"source": "autosave-test"},
    }


def test_autosave_delta_enqueues_pack_job(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(templates, "get_settings", lambda: SimpleNamespace(server_data_root=str(tmp_path)))
    monkeypatch.setattr(draft_pack_queue, "get_settings", lambda: SimpleNamespace(server_data_root=str(tmp_path)))

    req = templates.TemplateNativeAutosaveDeltaRequest(
        doc_json=_doc(),
        source="unit-test",
        delta_id="delta-1",
    )
    out = templates.save_template_native_autosave_delta("proj_queue", req)
    assert out["ok"] is True
    assert out["status"] == "autosave_delta_saved"
    assert out["packaging"] == "queued"
    assert isinstance(out.get("queued_job_id"), str) and out["queued_job_id"]

    draft_root = tmp_path / "projects" / "proj_queue" / "native" / "draft"
    assert (draft_root / "doc.json").exists()
    data = json.loads((draft_root / "doc.json").read_text(encoding="utf-8"))
    image_node = next((n for n in data.get("nodes", []) if n.get("id") == "img"), {})
    assert image_node.get("image_src") == "/api/assets/11111111-1111-4111-8111-111111111111"

    queue_file = tmp_path / "_draft_pack_queue" / "pending" / f"{out['queued_job_id']}.json"
    assert queue_file.exists()


def test_autosave_delta_can_sync_current_without_versions(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(templates, "get_settings", lambda: SimpleNamespace(server_data_root=str(tmp_path)))
    monkeypatch.setattr(draft_pack_queue, "get_settings", lambda: SimpleNamespace(server_data_root=str(tmp_path)))

    req = templates.TemplateNativeAutosaveDeltaRequest(
        doc_json=_doc(),
        source="unit-test",
        delta_id="delta-2",
        sync_current=True,
    )
    out = templates.save_template_native_autosave_delta("proj_queue", req)

    assert out["ok"] is True
    assert out["status"] == "autosave_delta_saved"
    assert out["current_sync"]["paths"]["root"].endswith("/projects/proj_queue/native")

    native_root = tmp_path / "projects" / "proj_queue" / "native"
    assert (native_root / "doc.json").exists()
    current_doc = json.loads((native_root / "doc.json").read_text(encoding="utf-8"))
    image_node = next((n for n in current_doc.get("nodes", []) if n.get("id") == "img"), {})
    assert image_node.get("image_src") == "/api/assets/11111111-1111-4111-8111-111111111111"
    assert not (native_root / "versions" / "v1").exists()
