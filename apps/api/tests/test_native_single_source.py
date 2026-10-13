"""Task 1 — the live version is the single source: every autosave writes native/doc.json.

Target regression: autosave used to write only native/draft/doc.json (sync_current
defaulted to False), so the live version (native/doc.json + DB) went stale and the editor
did not see the change. This test proves autosave now writes the live version.

Hermetic: redirects the data root to a tmp dir via monkeypatch in
_project_packs_root; uses db=None (the disk write is independent of the DB).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com,other@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import templates  # noqa: E402


def _doc(title_text: str) -> dict[str, Any]:
    """Minimal valid native doc with a text node 'title_1'."""
    base_text_style = {
        "family": "Inter",
        "postscript": "Inter-Regular",
        "style": "Regular",
        "size": 42,
        "line_height": 110,
        "line_height_unit": "percent",
        "letter_spacing": 0,
        "text_align": "left",
        "vertical_align": "top",
    }
    base_layout = {
        "direction": "none", "gap": 0,
        "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0,
        "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False,
    }
    base_style = {
        "visible": True, "opacity": 1, "blend_mode": "normal",
        "fill": "#111111", "stroke": None, "effects": [],
        "image_fit": "fill", "image_crop": None, "mask": False,
    }
    return {
        "version": 1,
        "template_kind": "folder",
        "canvas": {"width": 1080, "height": 1080, "background": "#ffffff"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root", "parent_id": None, "children_ids": ["title_1"],
                "name": "ROOT", "kind": "frame",
                "geometry": {"x": 0, "y": 0, "width": 1080, "height": 1080, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0},
                "layout": base_layout, "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {**base_style, "fill": "#ffffff"}, "text": None, "text_style": base_text_style,
                "text_runs": [], "text_path": None, "image_src": None, "editable": False,
            },
            {
                "id": "title_1", "parent_id": "root", "children_ids": [],
                "name": "Title1", "kind": "text",
                "geometry": {"x": 120, "y": 120, "width": 840, "height": 100, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1},
                "layout": base_layout, "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": base_style, "text": title_text, "text_style": base_text_style,
                "text_runs": [], "text_path": None, "image_src": None, "editable": True,
            },
        ],
        "bindings": {"text": {}, "images_single": {}, "images_array": {}, "product_frames": None},
        "dynamic_rules": [],
        "metadata": {"source": "unit-test"},
    }


def _title_of(doc: dict[str, Any]) -> str:
    return next(n["text"] for n in doc["nodes"] if n["id"] == "title_1")


def test_autosave_writes_live_doc_even_without_sync_current(monkeypatch, tmp_path: Path) -> None:
    projects_root = tmp_path / "projects"
    projects_root.mkdir(parents=True)
    monkeypatch.setattr(templates, "_project_packs_root", lambda: projects_root)
    # Packaging is asynchronous and out of scope for this test.
    monkeypatch.setattr(templates, "enqueue_draft_pack_job", lambda **kw: "job-test")

    key = "proj_singlesource"
    native_root = projects_root / key / "native"
    native_root.mkdir(parents=True)
    # Initial live version = OLD (what the editor would show today).
    (native_root / "doc.json").write_text(json.dumps(_doc("OLD")), encoding="utf-8")
    (native_root / "pack.meta.json").write_text(json.dumps({"template_name": "Proj SingleSource"}), encoding="utf-8")

    # Autosave of a NEW edit, WITHOUT passing sync_current (defaults to False).
    req = templates.TemplateNativeAutosaveDeltaRequest(doc_json=_doc("NEW-LIVE"))
    templates.save_template_native_autosave_delta(key, req, db=None)

    # The live version on disk must reflect the new edit.
    live = json.loads((native_root / "doc.json").read_text(encoding="utf-8"))
    assert _title_of(live) == "NEW-LIVE", "autosave did not update the live version (native/doc.json)"


def test_save_draft_endpoint_writes_live_doc(monkeypatch, tmp_path: Path) -> None:
    projects_root = tmp_path / "projects"
    projects_root.mkdir(parents=True)
    monkeypatch.setattr(templates, "_project_packs_root", lambda: projects_root)

    key = "proj_draftlive"
    native_root = projects_root / key / "native"
    native_root.mkdir(parents=True)
    (native_root / "doc.json").write_text(json.dumps(_doc("OLD")), encoding="utf-8")
    (native_root / "pack.meta.json").write_text(json.dumps({"template_name": "Proj DraftLive"}), encoding="utf-8")

    req = templates.TemplateNativeDraftRequest(doc_json=_doc("DRAFT-LIVE"))
    templates.save_template_native_draft(key, req, db=None)

    live = json.loads((native_root / "doc.json").read_text(encoding="utf-8"))
    assert _title_of(live) == "DRAFT-LIVE", "save-draft did not update the live version (native/doc.json)"
