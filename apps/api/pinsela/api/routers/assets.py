from __future__ import annotations

import hashlib
from io import BytesIO
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import Text, cast, or_
from sqlalchemy.orm import Session

from pinsela.auth import require_admin
from pinsela.config import get_settings
from pinsela.db import db_session
from pinsela.models import InputAsset
from pinsela.services.background_removal import (
    BackgroundRemovalError,
    derive_background_removed_name,
    merge_background_removed_tags,
    remove_background_image,
    resolve_image_source,
)


router = APIRouter(prefix="/api/assets", tags=["assets"], dependencies=[Depends(require_admin)])


MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _asset_root() -> Path:
    settings = get_settings()
    p = Path(settings.server_data_root) / "assets"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _asset_thumbnail_root() -> Path:
    p = _asset_root() / "_thumbs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _norm_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for t in raw.split(","):
        s = t.strip()
        if not s:
            continue
        out.append(s)
    # de-dupe while preserving order
    seen: set[str] = set()
    uniq: list[str] = []
    for t in out:
        k = t.lower()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(t)
    return uniq[:50]


def _asset_name_for_upload(upload: UploadFile) -> str | None:
    raw = str(getattr(upload, "filename", "") or "").strip()
    if not raw:
        return None
    # Handles browser fake paths and Windows separators.
    base = raw.replace("\\", "/").split("/")[-1].strip()
    return base or None


def _ext_for_upload(upload: UploadFile) -> str:
    ct = (upload.content_type or "").lower()
    if ct in ("image/png",):
        return "png"
    if ct in ("image/jpeg", "image/jpg"):
        return "jpg"
    if ct in ("image/webp",):
        return "webp"

    # Fallback to filename extension.
    name = (upload.filename or "").lower()
    if name.endswith(".png"):
        return "png"
    if name.endswith(".jpg") or name.endswith(".jpeg"):
        return "jpg"
    if name.endswith(".webp"):
        return "webp"

    raise HTTPException(status_code=400, detail="Invalid format. Accepted: png, jpg, webp.")


def _image_dimensions_from_bytes(data: bytes) -> tuple[int, int]:
    try:
        from PIL import Image

        image = Image.open(BytesIO(data))
        image.load()
        return image.size
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupted image") from exc


def _serialize_asset(asset: InputAsset) -> dict[str, Any]:
    return {
        "id": str(asset.id),
        "kind": asset.kind,
        "name": asset.name,
        "tags": asset.tags,
        "mime_type": asset.mime_type,
        "ext": asset.ext,
        "bytes": asset.bytes,
        "width": asset.width,
        "height": asset.height,
        "sha256": asset.sha256,
        "created_at": asset.created_at,
        "preview_url": f"/api/assets/{asset.id}",
        "thumbnail_url": f"/api/assets/{asset.id}/thumbnail?w=320",
    }


def _normalized_thumb_size(raw_size: int | None) -> int:
    try:
        value = int(raw_size or 320)
    except Exception:
        value = 320
    return max(96, min(640, value))


def _thumbnail_response_from_bytes(
    *,
    cache_key: str,
    image_bytes: bytes,
    max_side: int,
) -> FileResponse:
    thumb_size = _normalized_thumb_size(max_side)
    root = _asset_thumbnail_root()
    ext = "webp"
    dest = root / f"{cache_key}-{thumb_size}.{ext}"
    if not dest.exists():
        try:
            from PIL import Image, ImageOps
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Pillow is not available to generate thumbnails.") from exc

        try:
            image = Image.open(BytesIO(image_bytes))
            image.load()
            image = ImageOps.exif_transpose(image)
            image.thumbnail((thumb_size, thumb_size), Image.Resampling.LANCZOS)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            tmp = root / f".tmp-{cache_key}-{thumb_size}.{ext}"
            save_kwargs = {"format": "WEBP", "quality": 82, "method": 6}
            image.save(tmp, **save_kwargs)
            os.replace(tmp, dest)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not generate a thumbnail for the asset.") from exc
        finally:
            try:
                tmp = root / f".tmp-{cache_key}-{thumb_size}.{ext}"
                if tmp.exists():
                    tmp.unlink()
            except Exception:
                pass

    return FileResponse(
        str(dest),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400"},
    )


def _store_image_asset(
    db: Session,
    *,
    data: bytes,
    ext: str,
    mime_type: str,
    name: str | None = None,
    tags: list[str] | None = None,
) -> InputAsset:
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (25MB limit)")

    width, height = _image_dimensions_from_bytes(data)
    sha256 = hashlib.sha256(data).hexdigest()

    asset_id = uuid.uuid4()
    root = _asset_root()
    dest = root / f"{asset_id}.{ext}"
    tmp = root / f".tmp-{asset_id}.{ext}"
    try:
        tmp.write_bytes(data)
        os.replace(tmp, dest)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass

    asset = InputAsset(
        id=asset_id,
        kind="image",
        name=(name or "").strip() or None,
        tags=list(tags or []),
        mime_type=mime_type,
        ext=ext,
        bytes=len(data),
        width=width,
        height=height,
        sha256=sha256,
        server_path=str(dest),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


class RemoveBackgroundRequest(BaseModel):
    source: str = Field(min_length=1)
    name: str | None = None
    tags: list[str] | None = None
    model: str | None = None
    # Opt-in: slower closed-form matting for fine hair edges. Off by default —
    # the fast single-pass path is what the editor button uses.
    alpha_matting: bool = False


@router.post("/upload")
async def upload_image(
    db: Session = Depends(db_session),
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    tags: str | None = Form(default=None),
) -> dict[str, Any]:
    ext = _ext_for_upload(file)
    # MIME comes from the validated extension, never from the client Content-Type (which would be
    # served back by GET /api/assets/{id}: text/html here would become stored XSS).
    mime = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}[ext]

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    asset = _store_image_asset(
        db,
        data=data,
        ext=ext,
        mime_type=mime,
        name=(name or "").strip() or _asset_name_for_upload(file),
        tags=_norm_tags(tags),
    )

    return {
        "ok": True,
        "asset": _serialize_asset(asset),
    }


@router.post("/remove-background")
def remove_background(
    payload: RemoveBackgroundRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    try:
        resolved = resolve_image_source(payload.source, db=db)
        result = remove_background_image(
            resolved, model_name=payload.model, alpha_matting=payload.alpha_matting
        )
    except BackgroundRemovalError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    asset = _store_image_asset(
        db,
        data=result.png_bytes,
        ext="png",
        mime_type="image/png",
        name=derive_background_removed_name(payload.name or resolved.name),
        tags=merge_background_removed_tags(resolved.tags, payload.tags),
    )
    return {
        "ok": True,
        "asset": _serialize_asset(asset),
        "meta": {
            "model": result.model_name,
            "source_kind": resolved.source_kind,
        },
    }


@router.get("")
def list_assets(
    db: Session = Depends(db_session),
    limit: int = 60,
    offset: int = 0,
    q: str | None = None,
    tag: str | None = None,
) -> dict[str, Any]:
    limit = min(200, max(1, limit))
    offset = max(0, offset)

    query = db.query(InputAsset)
    if q and q.strip():
        s = f"%{q.strip()}%"
        query = query.filter(or_(InputAsset.name.ilike(s), cast(InputAsset.tags, Text).ilike(s)))  # type: ignore[arg-type]
    if tag and tag.strip():
        query = query.filter(InputAsset.tags.contains([tag.strip()]))  # type: ignore[arg-type]

    items = query.order_by(InputAsset.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "ok": True,
        "items": [_serialize_asset(a) for a in items],
        "next_offset": (offset + limit) if len(items) == limit else None,
    }


@router.get("/{asset_id}/thumbnail")
def get_asset_thumbnail(asset_id: uuid.UUID, db: Session = Depends(db_session), w: int = 320) -> FileResponse:
    asset = db.query(InputAsset).filter(InputAsset.id == asset_id).one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    p = Path(asset.server_path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="File not found on server")

    return _thumbnail_response_from_bytes(
        cache_key=f"asset-{asset.id}-{asset.sha256[:20]}",
        image_bytes=p.read_bytes(),
        max_side=w,
    )


def _find_unregistered_asset_file(asset_id: uuid.UUID) -> Path | None:
    """Locate an on-disk asset file ``<asset_id>.<ext>`` that has no DB row.

    The agent/composer writes assets straight to the assets dir and references
    them by id; if it skipped DB registration the file still exists on disk.
    The Python renderer reads it directly, so the editor must too — otherwise
    the in-editor view diverges from the exported PNG. ``asset_id`` is a parsed
    ``uuid.UUID`` so the filename cannot traverse out of the assets root.
    """
    root = _asset_root()
    for candidate in sorted(root.glob(f"{asset_id}.*")):
        if candidate.is_file():
            return candidate
    return None


@router.get("/{asset_id}")
def get_asset(asset_id: uuid.UUID, db: Session = Depends(db_session)):
    asset = db.query(InputAsset).filter(InputAsset.id == asset_id).one_or_none()
    if asset:
        p = Path(asset.server_path)
        if p.exists() and p.is_file():
            # Never trust the stored mime (old rows came from the client).
            safe_mime = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}.get(
                p.suffix.lower(), "application/octet-stream"
            )
            return FileResponse(str(p), media_type=safe_mime)

    # Fallback: file present on disk but not DB-registered (agent-authored).
    fallback = _find_unregistered_asset_file(asset_id)
    if fallback is not None:
        mime = mimetypes.guess_type(str(fallback))[0] or "application/octet-stream"
        if not mime.startswith("image/") or "svg" in mime:
            mime = "application/octet-stream"
        return FileResponse(str(fallback), media_type=mime)

    raise HTTPException(status_code=404, detail="Asset not found")
