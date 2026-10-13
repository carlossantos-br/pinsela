"""Agent macro preprocessor + render router.

Exposes the doc-macro expansion pipeline as HTTP endpoints. Mirrors the shape
of ``/api/agent/render`` so agents can drop in this convenience endpoint
without rewriting client code.

Endpoints:

    POST /api/agent/macros/expand    expand a doc and return the new doc
    POST /api/agent/macros/render    expand + render → PNG/JPG bytes
    POST /api/agent/macros/gradient  generate a standalone gradient PNG
    GET  /api/agent/macros/presets   describe available macros and schemas

Mount from main.py exactly like ``agent.router``. Auth dependency reuses
``require_agent_principal`` from the existing agent router.
"""

from __future__ import annotations

import base64
import hashlib
import io
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.responses import Response

from pinsela.db import db_session

from pinsela.api.routers.agent import (
    _apply_scale_and_background,
    _json_error,
    require_agent_principal,
)
from pinsela.services.doc_macros import (
    SUPPORTED_MACROS,
    added_nodes_count,
    expand_macros,
)
from pinsela.services.gradient_renderer import (
    render_gradient_to_file,
)
from pinsela.services.render_engine_native import (
    NativeRenderEngineError,
    render_native_template,
)
from pinsela.services.template_native import validate_native_doc


router = APIRouter(prefix="/api/agent/macros", tags=["agent", "macros"])


# --------------------------------------------------------------------------- #
# Request models.
# --------------------------------------------------------------------------- #


class ExpandRequest(BaseModel):
    doc: dict[str, Any]


class MacroRenderRequest(BaseModel):
    doc: dict[str, Any]
    payload: dict[str, Any] | None = None
    output_kind: Literal["png", "jpg", "both"] = "png"
    scale: float = Field(default=1.0, ge=0.25, le=4.0)
    background_mode: Literal["as-is", "transparent", "white"] = "as-is"
    return_format: Literal["binary", "base64", "both"] = "binary"


class GradientRequest(BaseModel):
    width: int = Field(ge=1, le=8192)
    height: int = Field(ge=1, le=8192)
    angle: float = 0.0
    stops: list[Any]
    type: Literal["linear", "radial"] = "linear"
    transparent: bool = False
    center: list[float] | None = None
    radius: float | None = None
    noise: float = Field(default=0.0, ge=0.0, le=1.0)


# --------------------------------------------------------------------------- #
# Endpoints.
# --------------------------------------------------------------------------- #


@router.get("/presets")
def list_presets(_principal: str = Depends(require_agent_principal)) -> dict[str, Any]:
    """Document the available macros + their accepted parameters."""
    return {
        "ok": True,
        "macros": sorted(SUPPORTED_MACROS),
        "schemas": {
            "drop_shadow": {
                "offset_x": "float (px, default 0)",
                "offset_y": "float (px, default 4)",
                "blur_px": "float (px, default 8) — controls layer feathering",
                "color": "string (#RRGGBB, default '#000000')",
                "opacity": "float 0..1 (default 0.35)",
                "layer_count": "optional int override (default auto from blur)",
            },
            "glow": {
                "radius": "float (px, default 24)",
                "color": "string (#RRGGBB, default '#FFFFFF')",
                "intensity": "float 0..1 (default 0.55)",
                "layer_count": "optional int override",
            },
            "gradient": {
                "type": "'linear' | 'radial' (default 'linear')",
                "angle": "float (linear only, degrees; 0=L→R, 90=T→B)",
                "stops": "[{offset:0..1,color:'#RRGGBB'}, ...]",
                "transparent": "bool — when true, alpha-zero outside stops "
                "(for 'gradient without a backdrop')",
                "center": "[cx, cy] (radial only, optional)",
                "radius": "float (radial only, optional; default half diagonal)",
            },
            "brush": {
                "preset": "'ink' | 'marker' | 'chalk' | 'spray'",
                "weight": "float (px, default 6)",
                "color": "string (#RRGGBB, default '#1F1F1F')",
                "count": "optional int (default depends on preset)",
            },
            "metallic": {
                "colors": "[c1, c2, c3] (default gold ramp)",
                "direction": "'vertical' | 'horizontal' (default 'vertical')",
                "noise": "float 0..1 (default 0.08) — brushed-metal grain",
                "transparent": "bool — keep transparent background outside stops",
                "_notes": (
                    "Pre-renders a gradient PNG with noise and sets it as "
                    "image_src — ideal for the eyebrow metallic bar."
                ),
            },
            "photo_tint": {
                "color": "string (#RRGGBB, default '#D4A867')",
                "strength": "float 0..1 (default 0.18) — overlay alpha",
                "_notes": "Adds a translucent colored rect over the node area.",
            },
            "soft_shadow": {
                "offset_x": "float px (default 0)",
                "offset_y": "float px (default 12)",
                "blur": "float px (default 24) — Gaussian radius",
                "color": "string (#RRGGBB, default '#000000')",
                "opacity": "float 0..1 (default 0.30)",
                "_notes": (
                    "True Gaussian shadow pre-rendered as PNG. Cleaner than "
                    "drop_shadow (which stacks rects). Use for photo cards."
                ),
            },
            "photo_border": {
                "color": "string (#RRGGBB, default '#9B7B3F')",
                "weight": "float px (default 2)",
                "_notes": (
                    "Inset stroke on top of an image — gives a subtle border "
                    "that follows the photo's corner radius."
                ),
            },
            "corner_brackets": {
                "length": "float px (default 60) — arm length",
                "weight": "float px (default 3) — arm thickness",
                "color": "string (#RRGGBB, default '#9B7B3F')",
                "inset": (
                    "float px (default 24) — offset outside the frame "
                    "(negative = inside)"
                ),
                "_notes": (
                    "Auto-generates 4 L-shaped brackets at the corners of a "
                    "frame so Claude doesn't have to hand-compute 8 rects."
                ),
            },
            "vignette": {
                "color": "string (#RRGGBB, default '#000000')",
                "strength": "float 0..1 (default 0.45) — alpha at corners",
                "falloff": "float 0..1 (default 0.55) — inner radius",
                "_notes": (
                    "Radial dark overlay around an image. Subtle by default."
                ),
            },
        },
        "usage": (
            "Add an `_macros` dict on any node. Multiple macros can stack on "
            "the same node. Call POST /api/agent/macros/render to render the "
            "expanded doc in one shot."
        ),
    }


@router.post("/expand")
def expand_endpoint(
    req: ExpandRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Expand macros and return the resulting doc.

    Returns the validated expanded doc — guaranteed to pass
    ``validate_native_doc``.
    """
    try:
        expanded = expand_macros(req.doc)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"expand_failed:{exc}")

    added = added_nodes_count(expanded)
    # Drop our internal stats key before validation.
    expanded_clean = dict(expanded)
    expanded_clean.pop("_macro_stats", None)

    try:
        validated = validate_native_doc(expanded_clean)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"invalid_after_expand:{exc}")

    return {
        "ok": True,
        "expanded_doc": validated,
        "added_nodes_count": added,
        "stats": expanded.get("_macro_stats", {}),
    }


@router.post("/render")
def render_endpoint(
    req: MacroRenderRequest,
    _principal: str = Depends(require_agent_principal),
    db: Session = Depends(db_session),
):
    """Expand macros then render. Output matches /api/agent/render exactly."""
    try:
        expanded = expand_macros(req.doc)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"expand_failed:{exc}")

    expanded.pop("_macro_stats", None)

    try:
        validated = validate_native_doc(expanded)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"invalid_after_expand:{exc}")

    payload = req.payload or {}
    bg_mode = str(req.background_mode or "as-is")
    started = time.monotonic()
    try:
        rendered = render_native_template(
            validated, payload, db=db, background_mode=bg_mode
        )
    except NativeRenderEngineError as exc:
        return Response(
            content=_json_error(str(exc), "NativeRenderEngineError"),
            status_code=500,
            media_type="application/json",
        )
    except Exception as exc:  # noqa: BLE001
        return Response(
            content=_json_error(str(exc), type(exc).__name__),
            status_code=500,
            media_type="application/json",
        )

    requested = req.output_kind
    exts: list[str] = (
        ["png"] if requested == "png" else (["jpg"] if requested == "jpg" else ["png", "jpg"])
    )

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
            "X-Macros-Added-Nodes": str(added_nodes_count(expanded)),
        }
        return Response(content=info["bytes"], media_type=media, headers=headers)

    body: dict[str, Any] = {
        "ok": True,
        "duration_ms": duration_ms,
        "background_mode": bg_mode,
        "scale": float(req.scale or 1.0),
        "added_nodes_count": added_nodes_count(expanded),
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


@router.post("/gradient")
def gradient_endpoint(
    req: GradientRequest,
    _principal: str = Depends(require_agent_principal),
):
    """Generate a standalone gradient PNG.

    Returns the image as binary. Useful when you need a gradient asset alone
    (no surrounding doc) — e.g. "create gradient without bg".
    """
    # Stops can arrive as [{"offset":..,"color":..}] or [[offset,color]].
    try:
        center = None
        if req.center and len(req.center) == 2:
            center = (float(req.center[0]), float(req.center[1]))
        path, data = render_gradient_to_file(
            width=req.width,
            height=req.height,
            gradient_type=req.type,
            angle=req.angle,
            center=center,
            radius=req.radius,
            stops=req.stops,
            transparent=req.transparent,
            noise=req.noise,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"gradient_failed:{exc}")

    sha = hashlib.sha256(data).hexdigest()
    headers = {
        "X-Gradient-Sha256": sha,
        "X-Gradient-Bytes": str(len(data)),
        "X-Gradient-Cache-Path": str(path),
    }
    return Response(content=data, media_type="image/png", headers=headers)
