from __future__ import annotations

"""Agent visual-diff router.

Provides image-comparison endpoints for the agent loop (render → diff →
adjust). Used by the "copy this artwork" workflow.

Mount is intentionally NOT done here — `apps/api/pinsela/api/main.py` is
modified by the integration agent (10) so this router can be added/removed
cleanly.
"""

import base64
import io
import sys
import time
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

# Reuse the agent auth dependency.
from pinsela.api.routers.agent import require_agent_principal
from pinsela.config import get_settings
from pinsela.security import resolve_under


# Add the scripts/agent-tools dir to sys.path so we can import the ops module.
_OPS_DIR = Path(__file__).resolve().parents[5] / "scripts" / "agent-tools"
if str(_OPS_DIR) not in sys.path:
    sys.path.insert(0, str(_OPS_DIR))

import visual_diff_ops as vdo  # noqa: E402


router = APIRouter(prefix="/api/agent/diff", tags=["agent-diff"])


# --------------------------------------------------------------------------- #
# Models.
# --------------------------------------------------------------------------- #


class DiffCompareRequest(BaseModel):
    ref_path: str = Field(..., description="Reference image path inside the server data root")
    cand_path: str = Field(..., description="Candidate image path inside the server data root")
    grid: Optional[List[int]] = Field(
        default=None, description="Region grid [cols, rows]; defaults to [6, 6]"
    )


class DiffCompareBase64Request(BaseModel):
    ref_base64: str = Field(..., description="Reference image as base64-encoded bytes")
    cand_base64: str = Field(..., description="Candidate image as base64-encoded bytes")
    grid: Optional[List[int]] = Field(
        default=None, description="Region grid [cols, rows]; defaults to [6, 6]"
    )


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #


def _confine(raw: str, label: str) -> Path:
    """Paths come from an HTTP request: only inside the data root (an escaping symlink is rejected)."""
    root = Path(get_settings().server_data_root).expanduser().resolve()
    try:
        return resolve_under(root, raw, must_exist=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"{label}_not_found") from None
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label}_outside_data_root") from None


def _normalize_grid(g: Optional[List[int]], default: tuple[int, int] = (6, 6)) -> tuple[int, int]:
    if not g:
        return default
    if len(g) != 2:
        raise HTTPException(status_code=422, detail="grid_must_be_two_ints")
    a, b = int(g[0]), int(g[1])
    if a < 1 or b < 1 or a > 32 or b > 32:
        raise HTTPException(status_code=422, detail="grid_out_of_range_1_32")
    return (a, b)


def _decode_to_tempfile(b64: str, suffix: str = ".png") -> Path:
    import tempfile

    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid_base64:{exc}") from exc
    if not raw:
        raise HTTPException(status_code=422, detail="empty_base64")
    fd, p = tempfile.mkstemp(prefix="pinsela_diff_", suffix=suffix)
    try:
        with open(fd, "wb") as f:
            f.write(raw)
    except Exception:
        Path(p).unlink(missing_ok=True)
        raise
    return Path(p)


# --------------------------------------------------------------------------- #
# Endpoints.
# --------------------------------------------------------------------------- #


@router.post("/compare")
def diff_compare(
    req: DiffCompareRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Compare two images by absolute path. Returns the full structured report."""
    ref = _confine(req.ref_path, "ref")
    cand = _confine(req.cand_path, "cand")
    grid = _normalize_grid(req.grid)

    started = time.monotonic()
    try:
        report = vdo.compare(str(ref), str(cand), grid=grid)
    except Exception as exc:  # noqa: BLE001 — surface engine errors to agent
        raise HTTPException(status_code=500, detail=f"compare_failed:{exc}") from exc
    report["duration_ms"] = int(round((time.monotonic() - started) * 1000))
    return report


@router.post("/compare-base64")
def diff_compare_base64(
    req: DiffCompareBase64Request,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Compare two inline base64 images. Returns the full structured report."""
    grid = _normalize_grid(req.grid)
    ref_tmp = _decode_to_tempfile(req.ref_base64)
    cand_tmp = _decode_to_tempfile(req.cand_base64)
    try:
        # Validate they are openable images before running.
        try:
            with Image.open(ref_tmp) as im:
                im.verify()
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"invalid_ref_image:{exc}") from exc
        try:
            with Image.open(cand_tmp) as im:
                im.verify()
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"invalid_cand_image:{exc}") from exc

        started = time.monotonic()
        try:
            report = vdo.compare(str(ref_tmp), str(cand_tmp), grid=grid)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"compare_failed:{exc}") from exc
        report["duration_ms"] = int(round((time.monotonic() - started) * 1000))
        return report
    finally:
        ref_tmp.unlink(missing_ok=True)
        cand_tmp.unlink(missing_ok=True)


@router.post("/compare-v2")
def diff_compare_v2(
    req: DiffCompareRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Structural compare returning per-cell classification + clusters + patches."""
    ref = _confine(req.ref_path, "ref")
    cand = _confine(req.cand_path, "cand")
    grid = _normalize_grid(req.grid, default=(12, 12))

    started = time.monotonic()
    try:
        report = vdo.compare_v2(str(ref), str(cand), grid=grid)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"compare_v2_failed:{exc}") from exc
    report["duration_ms"] = int(round((time.monotonic() - started) * 1000))
    return report


@router.post("/compare-v2-base64")
def diff_compare_v2_base64(
    req: DiffCompareBase64Request,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Structural compare for inline base64 images."""
    grid = _normalize_grid(req.grid, default=(12, 12))
    ref_tmp = _decode_to_tempfile(req.ref_base64)
    cand_tmp = _decode_to_tempfile(req.cand_base64)
    try:
        try:
            with Image.open(ref_tmp) as im:
                im.verify()
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"invalid_ref_image:{exc}") from exc
        try:
            with Image.open(cand_tmp) as im:
                im.verify()
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"invalid_cand_image:{exc}") from exc

        started = time.monotonic()
        try:
            report = vdo.compare_v2(str(ref_tmp), str(cand_tmp), grid=grid)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"compare_v2_failed:{exc}") from exc
        report["duration_ms"] = int(round((time.monotonic() - started) * 1000))
        return report
    finally:
        ref_tmp.unlink(missing_ok=True)
        cand_tmp.unlink(missing_ok=True)


@router.get("/health")
def diff_health(_principal: str = Depends(require_agent_principal)) -> dict[str, Any]:
    """Tiny sanity check that the ops module is importable and Pillow works."""
    a = Image.new("RGB", (8, 8), (0, 0, 0))
    b = Image.new("RGB", (8, 8), (255, 255, 255))
    d = vdo.pixel_diff(a, b)
    return {"ok": True, "pixel_diff_sample": round(d, 4)}
