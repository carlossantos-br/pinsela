"""Agent background-removal router.

Endpoints under ``/api/agent/bg`` for the agent loop:

* ``POST /remove``        — JSON in / JSON out (base64).
* ``POST /remove-file``   — multipart upload OR JSON ``{image_path}``; writes
                            a PNG to disk and returns its path + metadata.
* ``GET  /models``        — list available rembg models with descriptions.
* ``GET  /backends``      — diagnostics: in-process rembg availability.

Auth reuses ``require_agent_principal`` from the existing agent router so we
don't fragment the auth surface.

This file is intentionally isolated. ``main.py`` is *not* modified here — agent
10 is responsible for mounting this router.
"""

from __future__ import annotations

import base64
import binascii
import json
from pathlib import Path
from typing import Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    UploadFile,
)
from pydantic import BaseModel, Field

from pinsela.api.routers.agent import require_agent_principal
from pinsela.config import get_settings
from pinsela.security import resolve_under
from pinsela.services.bg_remover import (
    BgRemoverError,
    auto_select_model,
    list_models,
    probe_backends,
    remove_background_detailed,
    trim_to_alpha,
)


router = APIRouter(prefix="/api/agent/bg", tags=["agent", "bg"])


MAX_BYTES = 25 * 1024 * 1024  # 25 MB hard cap, same as background_removal.py.


# --------------------------------------------------------------------------- #
# Schemas.
# --------------------------------------------------------------------------- #

class RemoveRequest(BaseModel):
    image_base64: str = Field(..., description="Raw base64 (no data URI prefix needed).")
    model: str | None = Field(
        default=None,
        description="rembg model name. If omitted, defaults to 'u2net' unless auto=True.",
    )
    auto: bool = Field(
        default=False,
        description="If true, ignore 'model' and auto-select via heuristic.",
    )
    alpha_matting: bool = Field(default=False)
    trim: bool = Field(
        default=False,
        description="Crop output to the bounding box of opaque pixels.",
    )


class RemoveFileRequest(BaseModel):
    """JSON variant for /remove-file when no multipart upload is sent."""

    image_path: str = Field(..., description="Path of a file inside the server data root (PINSELA_SERVER_DATA_ROOT).")
    output_path: str | None = Field(
        default=None,
        description="Output .png path inside '<data root>/agent_bg' (relative paths resolve there). Defaults to '<input stem>.nobg.png'.",
    )
    model: str | None = None
    auto: bool = False
    alpha_matting: bool = False
    trim: bool = False
    write_sidecar: bool = Field(
        default=True,
        description="Write a .json sidecar with metadata next to the output.",
    )


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #

def _decode_b64(value: str) -> bytes:
    raw = (value or "").strip()
    if raw.startswith("data:"):
        # data URI: cut to comma.
        comma = raw.find(",")
        if comma == -1:
            raise HTTPException(status_code=422, detail="invalid_data_uri")
        raw = raw[comma + 1:]
    try:
        data = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid_base64:{exc}") from exc
    if not data:
        raise HTTPException(status_code=422, detail="empty_image")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="image_too_large")
    return data


def _resolve_model(*, explicit: str | None, auto: bool, image_bytes: bytes) -> str:
    if auto:
        return auto_select_model(image_bytes)
    return (explicit or "u2net").strip() or "u2net"


def _data_root() -> Path:
    return Path(get_settings().server_data_root).expanduser().resolve()


def _bg_out_root() -> Path:
    """Only directory this endpoint writes to: <data root>/agent_bg."""
    p = _data_root() / "agent_bg"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_stem(name: str) -> str:
    base = Path(str(name or "").replace("\\", "/")).name
    stem = Path(base).stem
    cleaned = "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in stem).strip("._")
    return cleaned[:80] or "image"


def _confine_input(raw: str) -> Path:
    """image_path can only be read from inside the data root (symlinks that escape are rejected)."""
    try:
        p = resolve_under(_data_root(), raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="image_path_outside_data_root")
    if not p.is_file():
        raise HTTPException(status_code=404, detail="image_path_not_found")
    return p


def _confine_output(raw: str | None, *, default_name: str) -> Path:
    """output_path can only be written inside <data root>/agent_bg, always .png."""
    out_root = _bg_out_root()
    if raw:
        try:
            p = resolve_under(out_root, raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="output_path_outside_data_root")
        if p.suffix.lower() != ".png":
            raise HTTPException(status_code=400, detail="output_path_must_be_png")
        if p == out_root:
            raise HTTPException(status_code=400, detail="output_path_invalid")
        return p
    return out_root / f"{_safe_stem(default_name)}.nobg.png"


# --------------------------------------------------------------------------- #
# Endpoints.
# --------------------------------------------------------------------------- #

@router.get("/models")
def bg_models(
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    return {"ok": True, "models": list_models()}


@router.get("/backends")
def bg_backends(
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    return {"ok": True, "backends": probe_backends()}


@router.post("/remove")
def bg_remove(
    req: RemoveRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    image_bytes = _decode_b64(req.image_base64)
    model_name = _resolve_model(explicit=req.model, auto=req.auto, image_bytes=image_bytes)

    try:
        outcome = remove_background_detailed(
            image_bytes,
            model=model_name,
            alpha_matting=req.alpha_matting,
        )
    except BgRemoverError as exc:
        raise HTTPException(status_code=500, detail=f"bg_removal_failed:{exc}") from exc

    out_png = outcome.png_bytes
    bbox = outcome.bbox
    if req.trim:
        out_png, bbox = trim_to_alpha(out_png)

    return {
        "ok": True,
        "output_base64": base64.b64encode(out_png).decode("ascii"),
        "width": _peek_width(out_png),
        "height": _peek_height(out_png),
        "bytes": len(out_png),
        "model_used": outcome.model_used,
        "backend": outcome.backend,
        "alpha_matting": outcome.alpha_matting,
        "trim": req.trim,
        "bbox": list(bbox) if bbox else None,
    }


def _truthy(v: Any, default: bool = False) -> bool:
    if v is None or v == "":
        return default
    return str(v).strip().lower() in {"1", "true", "yes", "on"}


@router.post("/remove-file")
async def bg_remove_file(
    request: Request,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    # The body is read by hand: FastAPI cannot mix multipart fields with a
    # JSON model on the same route (the JSON branch was never reached).
    file: UploadFile | None = None
    json_body: RemoveFileRequest | None = None
    output_path: str | None = None
    model: str | None = None
    auto = alpha_matting = trim = False
    write_sidecar = True
    ctype = (request.headers.get("content-type") or "").lower()
    if ctype.startswith("multipart/form-data") or ctype.startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        up = form.get("file")
        if up is not None and hasattr(up, "read"):
            file = up  # type: ignore[assignment]
        output_path = form.get("output_path") or None  # type: ignore[assignment]
        model = form.get("model") or None  # type: ignore[assignment]
        auto = _truthy(form.get("auto"))
        alpha_matting = _truthy(form.get("alpha_matting"))
        trim = _truthy(form.get("trim"))
        write_sidecar = _truthy(form.get("write_sidecar"), True)
    elif ctype.startswith("application/json"):
        try:
            json_body = RemoveFileRequest.model_validate(await request.json())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"invalid_json_body:{exc}") from exc

    if file is not None:
        image_bytes = await file.read(MAX_BYTES + 1)
        if not image_bytes:
            raise HTTPException(status_code=422, detail="empty_upload")
        if len(image_bytes) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="image_too_large")
        out_path = _confine_output(output_path, default_name=file.filename or "upload.png")
        params = {
            "model": model,
            "auto": auto,
            "alpha_matting": alpha_matting,
            "trim": trim,
            "write_sidecar": write_sidecar,
            "original_size_bytes": len(image_bytes),
            "source": "multipart",
        }
    elif json_body is not None:
        in_path = _confine_input(json_body.image_path)
        out_path = _confine_output(json_body.output_path, default_name=in_path.name)
        if in_path.stat().st_size > MAX_BYTES:
            raise HTTPException(status_code=413, detail="image_too_large")
        image_bytes = in_path.read_bytes()
        params = {
            "model": json_body.model,
            "auto": json_body.auto,
            "alpha_matting": json_body.alpha_matting,
            "trim": json_body.trim,
            "write_sidecar": json_body.write_sidecar,
            "original_size_bytes": len(image_bytes),
            "source": "image_path",
            "input_path": str(in_path),
        }
    else:
        raise HTTPException(
            status_code=422,
            detail="missing_payload: provide multipart 'file' or JSON 'image_path'.",
        )

    model_name = _resolve_model(
        explicit=params["model"],
        auto=bool(params["auto"]),
        image_bytes=image_bytes,
    )

    try:
        outcome = remove_background_detailed(
            image_bytes,
            model=model_name,
            alpha_matting=bool(params["alpha_matting"]),
        )
    except BgRemoverError as exc:
        raise HTTPException(status_code=500, detail=f"bg_removal_failed:{exc}") from exc

    out_png = outcome.png_bytes
    bbox = outcome.bbox
    if params["trim"]:
        out_png, bbox = trim_to_alpha(out_png)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(out_png)

    metadata = {
        "input_path": params.get("input_path"),
        "output_path": str(out_path),
        "model_used": outcome.model_used,
        "backend": outcome.backend,
        "alpha_matting": outcome.alpha_matting,
        "trim": bool(params["trim"]),
        "bbox": list(bbox) if bbox else None,
        "width": _peek_width(out_png),
        "height": _peek_height(out_png),
        "bytes": len(out_png),
        "original_bytes": params["original_size_bytes"],
        "source": params["source"],
    }

    sidecar_path: str | None = None
    if params["write_sidecar"]:
        sidecar_path = str(out_path.with_suffix(out_path.suffix + ".json"))
        Path(sidecar_path).write_text(json.dumps(metadata, ensure_ascii=False, indent=2))

    return {
        "ok": True,
        "output_path": str(out_path),
        "sidecar_path": sidecar_path,
        **metadata,
    }


# --------------------------------------------------------------------------- #
# Tiny helpers (avoid re-parsing PNG when we already know dimensions).
# --------------------------------------------------------------------------- #

def _peek_width(png_bytes: bytes) -> int:
    return _peek_dims(png_bytes)[0]


def _peek_height(png_bytes: bytes) -> int:
    return _peek_dims(png_bytes)[1]


def _peek_dims(png_bytes: bytes) -> tuple[int, int]:
    # PNG IHDR: bytes 16..24 → width, height (big-endian).
    if len(png_bytes) < 24 or png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        return (0, 0)
    width = int.from_bytes(png_bytes[16:20], "big")
    height = int.from_bytes(png_bytes[20:24], "big")
    return width, height
