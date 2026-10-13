"""Agent reference-analysis router.

Endpoints under ``/api/agent/analyze`` for the agent loop:

* ``POST /reference``       — full design-DNA report for a reference image.
* ``POST /palette``         — fast palette-only extraction.
* ``POST /compare-layouts`` — alignment delta between a reference image and a
                              candidate ``pinsela_native_v1`` document.

Auth reuses ``require_agent_principal`` from the main agent router so the auth
surface stays uniform with ``agent_bg.py`` / ``agent_diff.py``.

This file is intentionally isolated — ``main.py`` is *not* modified here.
Agent 10 (router wiring) is responsible for mounting this router.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from pinsela.api.routers.agent import require_agent_principal
from pinsela.config import get_settings
from pinsela.services.reference_analyzer import (
    analyze_reference,
    compare_layouts,
    extract_palette,
    load_image_from_request,
)


router = APIRouter(prefix="/api/agent/analyze", tags=["agent", "analyze"])


# --------------------------------------------------------------------------- #
# Schemas.
# --------------------------------------------------------------------------- #


class ImageInputRequest(BaseModel):
    """Either base64 OR a path is accepted."""

    image_base64: str | None = Field(
        default=None,
        description="Raw base64 (data URI prefix tolerated).",
    )
    image_path: str | None = Field(
        default=None,
        description="Absolute local path readable by the API.",
    )


class PaletteRequest(ImageInputRequest):
    k: int = Field(default=5, ge=2, le=12, description="Number of palette bins.")


class CompareLayoutsRequest(BaseModel):
    ref_image_base64: str | None = None
    ref_image_path: str | None = None
    candidate_doc: dict[str, Any] = Field(
        default_factory=dict,
        description="An pinsela_native_v1 document or any nested dict with"
                    " 'geometry'/'frame'/'rect' fields per node.",
    )


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #


def _payload_dict(req: ImageInputRequest) -> dict[str, Any]:
    return {"image_base64": req.image_base64, "image_path": req.image_path}


# --------------------------------------------------------------------------- #
# Endpoints.
# --------------------------------------------------------------------------- #


@router.get("/health")
def analyze_health(_principal: str = Depends(require_agent_principal)) -> dict[str, Any]:
    return {"ok": True, "service": "reference_analyzer"}


def _data_root() -> Path:
    return Path(get_settings().server_data_root).expanduser().resolve()


@router.post("/reference")
def analyze_reference_endpoint(
    req: ImageInputRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    try:
        img = load_image_from_request(_payload_dict(req), allowed_root=_data_root())
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        report = analyze_reference(img)
    except Exception as exc:  # defensive: never 500 silently
        raise HTTPException(status_code=500, detail=f"analyze_failed:{exc}") from exc
    return {"ok": True, "analysis": report}


@router.post("/palette")
def analyze_palette_endpoint(
    req: PaletteRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    try:
        img = load_image_from_request(_payload_dict(req), allowed_root=_data_root())
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        palette = extract_palette(img, k=req.k)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"palette_failed:{exc}") from exc
    # Drop the raw rgb tuple from the API response — hex + share + role is enough.
    return {
        "ok": True,
        "palette": [
            {"hex": p["hex"], "share": p["share"], "role": p.get("role", "accent")}
            for p in palette
        ],
    }


@router.post("/compare-layouts")
def compare_layouts_endpoint(
    req: CompareLayoutsRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    payload = {
        "image_base64": req.ref_image_base64,
        "image_path": req.ref_image_path,
    }
    try:
        img = load_image_from_request(payload, allowed_root=_data_root())
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        result = compare_layouts(img, req.candidate_doc or {})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"compare_failed:{exc}") from exc
    return {"ok": True, **result}


__all__ = ["router"]
