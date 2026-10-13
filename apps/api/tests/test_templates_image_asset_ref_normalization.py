from __future__ import annotations

import os

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import templates


def test_normalize_doc_image_refs_sets_asset_path_from_uuid() -> None:
    asset_id = "11111111-2222-3333-4444-555555555555"
    doc = {
        "nodes": [
            {"id": "n1", "kind": "image", "image_asset_id": asset_id, "image_src": None},
        ]
    }
    out = templates._normalize_doc_image_refs(doc)
    node = out["nodes"][0]
    assert node["image_asset_id"] == asset_id
    assert node["image_src"] == f"/api/assets/{asset_id}"


def test_normalize_doc_image_refs_extracts_asset_id_from_api_path() -> None:
    asset_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    doc = {
        "nodes": [
            {"id": "n1", "kind": "image", "image_src": f"/api/assets/{asset_id}"},
        ]
    }
    out = templates._normalize_doc_image_refs(doc)
    node = out["nodes"][0]
    assert node["image_asset_id"] == asset_id
    assert node["image_src"] == f"/api/assets/{asset_id}"

