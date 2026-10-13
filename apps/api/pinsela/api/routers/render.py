from __future__ import annotations

import hashlib
import io
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.responses import Response

from pinsela.auth import require_admin
from pinsela.config import get_settings
from pinsela.db import db_session
from pinsela.models import TemplateDefinition
from pinsela.services.render_engine import (
    RenderEngineError,
    apply_payload_to_svg,
    load_template_pack,
    render_svg_to_png_jpg,
)
from pinsela.services.render_engine_native import NativeRenderEngineError, render_native_template


router = APIRouter(prefix="/api/render", tags=["render"], dependencies=[Depends(require_admin)])


class RenderTestRequest(BaseModel):
    template_key: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    kind: Literal["png", "jpg", "webp", "bundle"] = "png"
    save: bool = False


class RenderNativeTestRequest(BaseModel):
    template_key: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    kind: Literal["png", "jpg", "bundle"] = "png"
    save: bool = False
    scale: float = Field(default=1.0, ge=0.25, le=4.0)
    area: Literal["page", "selection"] = "page"
    background_mode: Literal["as-is", "transparent", "white"] = "as-is"


def _render_test_root() -> Path:
    settings = get_settings()
    p = Path(settings.server_data_root) / "exports" / "render_test"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _apply_native_postprocess(
    rendered: dict[str, tuple[bytes, dict[str, Any]]],
    *,
    scale: float,
    area: str,
    background_mode: str,
    payload: dict[str, Any],
) -> dict[str, tuple[bytes, dict[str, Any]]]:
    bounds_raw = payload.get("__selection_bounds") if isinstance(payload, dict) else None
    selection_bounds: tuple[int, int, int, int] | None = None
    if area == "selection" and isinstance(bounds_raw, dict):
        try:
            x = int(round(float(bounds_raw.get("x", 0))))
            y = int(round(float(bounds_raw.get("y", 0))))
            w = int(round(float(bounds_raw.get("w", 0))))
            h = int(round(float(bounds_raw.get("h", 0))))
            if w > 0 and h > 0:
                selection_bounds = (x, y, w, h)
        except Exception:
            selection_bounds = None

    out: dict[str, tuple[bytes, dict[str, Any]]] = {}
    for ext in ("png", "jpg"):
        data, meta = rendered[ext]
        img = Image.open(io.BytesIO(data))
        if selection_bounds is not None:
            x, y, w, h = selection_bounds
            x = max(0, min(img.width - 1, x))
            y = max(0, min(img.height - 1, y))
            w = max(1, min(img.width - x, w))
            h = max(1, min(img.height - y, h))
            img = img.crop((x, y, x + w, y + h))

        if abs(scale - 1.0) > 1e-6:
            nw = max(1, int(round(img.width * scale)))
            nh = max(1, int(round(img.height * scale)))
            img = img.resize((nw, nh), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        if ext == "png":
            if background_mode == "white":
                if img.mode in ("RGBA", "LA"):
                    white = Image.new("RGB", img.size, (255, 255, 255))
                    white.paste(img, mask=img.split()[-1])
                    img = white
                elif img.mode != "RGB":
                    img = img.convert("RGB")
            elif background_mode == "transparent" and img.mode != "RGBA":
                img = img.convert("RGBA")
            img.save(buf, format="PNG")
        else:
            if img.mode in ("RGBA", "LA"):
                white = Image.new("RGB", img.size, (255, 255, 255))
                white.paste(img, mask=img.split()[-1])
                img = white
            elif img.mode != "RGB":
                img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=92, optimize=True)
        out_bytes = buf.getvalue()
        out_meta = {
            **meta,
            "width": img.width,
            "height": img.height,
            "bytes": len(out_bytes),
            "sha256": hashlib.sha256(out_bytes).hexdigest(),
            "scale": scale,
            "area": area,
            "background_mode": background_mode,
            "selection_applied": bool(selection_bounds is not None),
        }
        out[ext] = (out_bytes, out_meta)
    return out


@router.get("/test/{run_id}.{ext}")
def get_saved_test_render(run_id: str, ext: str):
    if ext not in ("png", "jpg", "webp"):
        raise HTTPException(status_code=400, detail="Invalid kind (expected png|jpg|webp)")
    # Basic safety: only allow UUID-ish names.
    try:
        uuid.UUID(run_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")

    p = _render_test_root() / f"{run_id}.{ext}"
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media = "image/png" if ext == "png" else ("image/webp" if ext == "webp" else "image/jpeg")
    return FileResponse(str(p), media_type=media)


@router.get("/preview/{task_id}.{ext}")
def get_preview_render(task_id: str, ext: str):
    if ext not in ("png", "jpg", "jpeg"):
        raise HTTPException(status_code=400, detail="Invalid kind (expected png|jpg)")
    # Basic safety: only allow UUID-ish names.
    try:
        uuid.UUID(task_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")

    settings = get_settings()
    root = Path(settings.server_data_root) / "exports" / "previews"
    fname = f"{task_id}.png" if ext == "png" else f"{task_id}.jpg"
    p = root / fname
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media = "image/png" if ext == "png" else "image/jpeg"
    return FileResponse(str(p), media_type=media)


@router.post("/test")
def render_test(req: RenderTestRequest, db: Session = Depends(db_session)):
    try:
        pack = load_template_pack(req.template_key)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    svg = pack.svg_path.read_bytes()
    try:
        svg2 = apply_payload_to_svg(svg, req.payload, pack.manifest, db=db)
        rendered = render_svg_to_png_jpg(svg2)
    except RenderEngineError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if req.kind == "bundle" or req.save:
        run_id = str(uuid.uuid4())
        root = _render_test_root()
        png, png_meta = rendered["png"]
        jpg, jpg_meta = rendered["jpg"]
        (root / f"{run_id}.png").write_bytes(png)
        (root / f"{run_id}.jpg").write_bytes(jpg)
        out: dict[str, Any] = {
            "ok": True,
            "run_id": run_id,
            "png_url": f"/api/render/test/{run_id}.png",
            "jpg_url": f"/api/render/test/{run_id}.jpg",
            "png_meta": png_meta,
            "jpg_meta": jpg_meta,
        }
        if "webp" in rendered:
            webp, webp_meta = rendered["webp"]
            (root / f"{run_id}.webp").write_bytes(webp)
            out["webp_url"] = f"/api/render/test/{run_id}.webp"
            out["webp_meta"] = webp_meta
        return out

    if req.kind == "jpg":
        data, _meta = rendered["jpg"]
        return Response(content=data, media_type="image/jpeg")

    if req.kind == "webp":
        if "webp" not in rendered:
            raise HTTPException(status_code=400, detail="WEBP not available (Pillow built without WEBP support)")
        data, _meta = rendered["webp"]
        return Response(content=data, media_type="image/webp")

    data, _meta = rendered["png"]
    return Response(content=data, media_type="image/png")


@router.post("/native/test")
def render_native_test(req: RenderNativeTestRequest, db: Session = Depends(db_session)):
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == req.template_key).one_or_none()
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if str(tpl.engine_type or "").strip() != "pinsela_native_v1":
        raise HTTPException(status_code=409, detail="Template is not native.")
    if not isinstance(tpl.engine_doc_json, dict) or not tpl.engine_doc_json:
        raise HTTPException(status_code=400, detail="Native template has no engine_doc_json.")

    try:
        rendered = render_native_template(
            tpl.engine_doc_json,
            req.payload or {},
            db=db,
            background_mode=req.background_mode,
        )
    except NativeRenderEngineError as e:
        raise HTTPException(status_code=400, detail=str(e))
    rendered = _apply_native_postprocess(
        rendered,
        scale=float(req.scale or 1.0),
        area=str(req.area or "page"),
        background_mode=str(req.background_mode or "as-is"),
        payload=req.payload or {},
    )

    if req.kind == "bundle" or req.save:
        run_id = str(uuid.uuid4())
        root = _render_test_root()
        png, png_meta = rendered["png"]
        jpg, jpg_meta = rendered["jpg"]
        (root / f"{run_id}.png").write_bytes(png)
        (root / f"{run_id}.jpg").write_bytes(jpg)
        return {
            "ok": True,
            "run_id": run_id,
            "png_url": f"/api/render/test/{run_id}.png",
            "jpg_url": f"/api/render/test/{run_id}.jpg",
            "png_meta": png_meta,
            "jpg_meta": jpg_meta,
            "engine_type": "pinsela_native_v1",
        }

    if req.kind == "jpg":
        data, _meta = rendered["jpg"]
        return Response(content=data, media_type="image/jpeg")

    data, _meta = rendered["png"]
    return Response(content=data, media_type="image/png")
