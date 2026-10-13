from __future__ import annotations

"""Agent dry-run router.

Provides local, inline-doc render/validate endpoints for the agent loop
(emit doc → render → see PNG → adjust). Kept isolated from the existing
integration/admin routers so it can be removed cleanly.
"""

import base64
import hashlib
import hmac
import io
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from PIL import Image
from pydantic import BaseModel, Field
from starlette.responses import Response

from pinsela.config import get_settings
from pinsela.security import is_trusted_local_request
from pinsela.services.render_engine_native import (
    NativeRenderEngineError,
    _font_dirs,
    render_native_template,
)
from pinsela.services.template_native import validate_native_doc


router = APIRouter(prefix="/api/agent", tags=["agent"])


_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def require_agent_principal(request: Request) -> str:
    """Auth dependency for agent endpoints.

    - If PINSELA_AGENT_TOKEN is set, require matching X-Agent-Token header
      (constant-time compare).
    - Otherwise, allow only loopback origins.
    """
    settings = get_settings()
    token = getattr(settings, "agent_token", None)
    if token:
        header_token = str(request.headers.get("X-Agent-Token") or "").strip()
        if not header_token or not hmac.compare_digest(header_token, token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid_agent_token",
            )
        return "token"
    # Loopback requires a loopback peer AND a local Host (anti DNS rebinding / reverse proxy).
    if not is_trusted_local_request(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="agent_token_required_or_loopback",
        )
    return "loopback"


class AgentRenderRequest(BaseModel):
    doc: dict[str, Any]
    payload: dict[str, Any] | None = None
    output_kind: Literal["png", "jpg", "both"] = "png"
    scale: float = Field(default=1.0, ge=0.25, le=4.0)
    background_mode: Literal["as-is", "transparent", "white"] = "as-is"
    return_format: Literal["binary", "base64", "both"] = "binary"


class AgentValidateRequest(BaseModel):
    doc: dict[str, Any]


def _apply_scale_and_background(
    data: bytes,
    *,
    ext: str,
    scale: float,
    background_mode: str,
) -> tuple[bytes, int, int]:
    img = Image.open(io.BytesIO(data))
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
    out = buf.getvalue()
    return out, img.width, img.height


def _minimal_doc() -> dict[str, Any]:
    """Tiny 1-node doc used by /health to exercise the renderer."""
    return {
        "version": "pinsela_native_v1",
        "root_id": "root",
        "canvas": {"width": 32, "height": 32, "background": "#ffffff"},
        "nodes": [
            {
                "id": "root",
                "kind": "frame",
                "name": "root",
                "geometry": {"x": 0, "y": 0, "w": 32, "h": 32, "z_index": 0},
            }
        ],
    }


@router.post("/render")
def agent_render(
    req: AgentRenderRequest,
    _principal: str = Depends(require_agent_principal),
):
    """Render an inline native doc and return PNG/JPG bytes or base64."""
    try:
        validated_doc = validate_native_doc(req.doc)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid_doc:{exc}")

    payload = req.payload or {}
    bg_mode = str(req.background_mode or "as-is")
    started = time.monotonic()
    try:
        rendered = render_native_template(
            validated_doc,
            payload,
            db=None,
            background_mode=bg_mode,
        )
    except NativeRenderEngineError as exc:
        return Response(
            content=_json_error(str(exc), "NativeRenderEngineError"),
            status_code=500,
            media_type="application/json",
        )
    except Exception as exc:  # noqa: BLE001 - surface engine errors to agent
        return Response(
            content=_json_error(str(exc), type(exc).__name__),
            status_code=500,
            media_type="application/json",
        )

    requested = req.output_kind
    exts: list[str] = ["png"] if requested == "png" else (["jpg"] if requested == "jpg" else ["png", "jpg"])

    processed: dict[str, dict[str, Any]] = {}
    for ext in exts:
        data, _meta = rendered[ext]
        out_bytes, w, h = _apply_scale_and_background(
            data,
            ext=ext,
            scale=float(req.scale or 1.0),
            background_mode=bg_mode,
        )
        processed[ext] = {
            "bytes": out_bytes,
            "width": w,
            "height": h,
            "size": len(out_bytes),
            "sha256": hashlib.sha256(out_bytes).hexdigest(),
        }

    duration_ms = int(round((time.monotonic() - started) * 1000))

    # Binary mode supports only a single image kind.
    if req.return_format == "binary":
        primary_ext = exts[0]
        info = processed[primary_ext]
        media = "image/png" if primary_ext == "png" else "image/jpeg"
        headers = {
            "X-Render-Width": str(info["width"]),
            "X-Render-Height": str(info["height"]),
            "X-Render-Bytes": str(info["size"]),
            "X-Render-Sha256": info["sha256"],
            "X-Render-Duration-Ms": str(duration_ms),
            "X-Render-Output-Kind": primary_ext,
        }
        return Response(content=info["bytes"], media_type=media, headers=headers)

    # base64 / both → JSON response
    body: dict[str, Any] = {
        "ok": True,
        "duration_ms": duration_ms,
        "background_mode": bg_mode,
        "scale": float(req.scale or 1.0),
    }
    if len(exts) == 1:
        ext = exts[0]
        info = processed[ext]
        body.update(
            {
                "output_kind": ext,
                "width": info["width"],
                "height": info["height"],
                "bytes": info["size"],
                "sha256": info["sha256"],
                "binary_base64": base64.b64encode(info["bytes"]).decode("ascii"),
            }
        )
    else:
        body["outputs"] = {
            ext: {
                "width": info["width"],
                "height": info["height"],
                "bytes": info["size"],
                "sha256": info["sha256"],
                "binary_base64": base64.b64encode(info["bytes"]).decode("ascii"),
            }
            for ext, info in processed.items()
        }
    return body


def _json_error(msg: str, error_type: str) -> bytes:
    import json

    return json.dumps(
        {"ok": False, "error": msg, "error_type": error_type},
        ensure_ascii=False,
    ).encode("utf-8")


@router.post("/validate")
def agent_validate(
    req: AgentValidateRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Validate a native doc and return the normalized form (or errors)."""
    try:
        normalized = validate_native_doc(req.doc)
    except Exception as exc:
        return {"ok": False, "errors": [str(exc)], "normalized_doc": None}
    return {"ok": True, "errors": None, "normalized_doc": normalized}


@router.get("/fonts")
def agent_fonts(
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """List font files found in the directories the renderer scans."""
    suffixes = {".ttf", ".otf", ".ttc", ".woff2"}
    seen: set[str] = set()
    fonts: list[dict[str, Any]] = []
    for raw_dir in _font_dirs():
        d = Path(raw_dir)
        exists = d.exists() and d.is_dir()
        if not exists:
            continue
        try:
            children = sorted(d.iterdir())
        except (PermissionError, OSError):
            continue
        for child in children:
            try:
                if not child.is_file():
                    continue
            except (PermissionError, OSError):
                continue
            if child.suffix.lower() not in suffixes:
                continue
            path_str = str(child.resolve())
            if path_str in seen:
                continue
            seen.add(path_str)
            stem = child.stem
            # Best-effort family/style split from "Family-Style.ttf".
            if "-" in stem:
                family, _, style = stem.partition("-")
            else:
                family, style = stem, "Regular"
            fonts.append(
                {
                    "postscript_name": stem,
                    "family": family,
                    "style": style or "Regular",
                    "path": path_str,
                    "exists": True,
                }
            )
    return {"ok": True, "fonts": fonts}


@router.get("/health")
def agent_health(request: Request) -> dict[str, Any]:
    """Public health probe. Attempts a tiny render to confirm the engine works."""
    fonts_dir_exists = any(Path(d).exists() for d in _font_dirs())
    sample_ok = False
    renderer_ready = False
    try:
        rendered = render_native_template(_minimal_doc(), {}, db=None)
        renderer_ready = True
        png_bytes, _meta = rendered["png"]
        sample_ok = bool(png_bytes)
    except Exception:
        sample_ok = False
    return {
        "ok": True,
        "service": "pinsela-agent",
        "renderer_ready": renderer_ready,
        "fonts_dir_exists": fonts_dir_exists,
        "sample_render_ok": sample_ok,
    }
