from __future__ import annotations

import os
from io import BytesIO
from types import SimpleNamespace
import uuid

from starlette.datastructures import UploadFile

# Router import touches Settings/DB module globals; keep test self-contained.
os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers.assets import _asset_name_for_upload, _norm_tags, _normalized_thumb_size, _serialize_asset, get_asset, _asset_root


def make_upload(filename: str) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(b"fake"))


def test_asset_name_defaults_to_filename() -> None:
    upload = make_upload("hero-final.png")
    assert _asset_name_for_upload(upload) == "hero-final.png"


def test_asset_name_returns_none_for_empty_filename() -> None:
    upload = make_upload("")
    assert _asset_name_for_upload(upload) is None


def test_asset_name_strips_client_paths() -> None:
    upload = make_upload(r"C:\fakepath\hero-final.png")
    assert _asset_name_for_upload(upload) == "hero-final.png"


def test_norm_tags_dedup_case_insensitive() -> None:
    assert _norm_tags("Promo, promo, HERO,hero, ") == ["Promo", "HERO"]


def test_normalized_thumb_size_clamps_range() -> None:
    assert _normalized_thumb_size(32) == 96
    assert _normalized_thumb_size(320) == 320
    assert _normalized_thumb_size(2048) == 640


def test_serialize_asset_exposes_thumbnail_url() -> None:
    asset_id = uuid.uuid4()
    asset = SimpleNamespace(
        id=asset_id,
        kind="image",
        name="hero.png",
        tags=["promo"],
        mime_type="image/png",
        ext="png",
        bytes=1234,
        width=1200,
        height=1200,
        sha256="abc123",
        created_at=None,
    )
    payload = _serialize_asset(asset)
    assert payload["preview_url"] == f"/api/assets/{asset_id}"
    assert payload["thumbnail_url"] == f"/api/assets/{asset_id}/thumbnail?w=320"


# --- Filesystem fallback for assets written by the agent but not DB-registered ---
class _StubQuery:
    def filter(self, *a, **k):
        return self

    def one_or_none(self):
        return None


class _StubDB:
    """A DB session where no asset is ever registered (forces the fallback)."""

    def query(self, *a, **k):
        return _StubQuery()


def test_get_asset_serves_unregistered_file_from_disk() -> None:
    """An asset file present on disk as <uuid>.<ext> must serve even when the
    DB has no row for it (agent-authored assets that skipped registration)."""
    from fastapi.responses import FileResponse

    asset_id = uuid.uuid4()
    target = _asset_root() / f"{asset_id}.png"
    # 1x1 PNG
    target.write_bytes(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000d49444154789c6360000002000100ffff03000006000557bf41ca000000"
            "0049454e44ae426082"
        )
    )
    try:
        res = get_asset(asset_id, _StubDB())
        assert isinstance(res, FileResponse)
        assert str(res.path) == str(target)
    finally:
        try:
            target.unlink()
        except OSError:
            pass


def test_get_asset_404_when_neither_db_nor_file() -> None:
    from fastapi import HTTPException

    asset_id = uuid.uuid4()  # no row, no file
    raised = False
    try:
        get_asset(asset_id, _StubDB())
    except HTTPException as exc:
        raised = exc.status_code == 404
    assert raised, "missing asset (no DB row, no file) must 404"
