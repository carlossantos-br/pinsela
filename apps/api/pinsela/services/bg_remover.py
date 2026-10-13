"""Background remover wrapper for agent tooling.

Provides a thin, agent-friendly facade over in-process ``rembg``.

The module is intentionally additive: it does not import or rely on the
existing :mod:`pinsela.services.background_removal` module, which embraces
DB-resolved assets and custom edge refinement. This module is the simpler,
"agent loop"-friendly building block for the new ``/api/agent/bg`` router and
the ``pinsela_remove_bg`` CLI.

Features:

* Cached session per (model, alpha_matting) tuple.
* Optional ``alpha_matting`` toggle.
* Heuristic auto model selection (portrait / product / generic).
* Transparency bbox trim and metadata sidecar (handled by callers).
"""

from __future__ import annotations

import base64
import io
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from PIL import Image, ImageOps


# --------------------------------------------------------------------------- #
# Configuration.
# --------------------------------------------------------------------------- #

DEFAULT_MODEL = "u2net"

# Known model catalogue with short descriptions for the /models endpoint.
MODELS: dict[str, str] = {
    "u2net": "General purpose, balanced quality/speed. Good default.",
    "u2netp": "Lightweight u2net (smaller, faster, lower quality).",
    "u2net_human_seg": "Tuned for whole humans (full body).",
    "u2net_cloth_seg": "Tuned for clothing segmentation.",
    "silueta": "u2net-quality at smaller file size.",
    "isnet-general-use": "High-quality general object segmentation. Best for products.",
    "isnet-anime": "Anime/illustration character segmentation.",
    "sam": "Segment Anything (heavy, needs prompt points).",
    "birefnet-general": "BiRefNet generalist, very high quality (heavy).",
    "birefnet-general-lite": "BiRefNet lightweight variant.",
    "birefnet-portrait": "BiRefNet tuned for portraits. Best for faces.",
    "birefnet-dis": "BiRefNet dichotomous segmentation.",
    "birefnet-hrsod": "BiRefNet high-resolution salient object.",
    "birefnet-cod": "BiRefNet camouflaged object detection.",
    "birefnet-massive": "BiRefNet largest model (very heavy).",
}


# --------------------------------------------------------------------------- #
# Public API.
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class BgRemovalOutcome:
    png_bytes: bytes
    width: int
    height: int
    model_used: str
    alpha_matting: bool
    backend: str  # "in_process"
    bbox: tuple[int, int, int, int] | None  # (left, top, right, bottom) of opaque pixels


class BgRemoverError(RuntimeError):
    """Raised when background removal cannot be performed."""


def list_models() -> list[dict[str, str]]:
    """Return rembg models with human descriptions."""
    return [{"name": name, "description": desc} for name, desc in MODELS.items()]


def auto_select_model(image_bytes: bytes) -> str:
    """Heuristic model picker.

    * If a face is detected and it dominates >= ~6% of the image → portrait.
    * If the image looks "product-like" (mostly uniform / few colours) → product.
    * Otherwise fall back to ``u2net``.

    Face detection uses PIL only (no opencv) via a tiny aspect-ratio + skin-tone
    heuristic. It's intentionally simple — we'd rather mis-route to a still-good
    model than pull in cv2.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            small = img.resize((64, 64))
            pixels = list(small.getdata())
    except Exception:
        return DEFAULT_MODEL

    # Skin tone heuristic (very loose): R > G > B, R in [95, 245], saturation moderate.
    skin = 0
    for r, g, b in pixels:
        if 95 <= r <= 245 and r > g >= b and (r - b) >= 15 and (r - g) <= 80:
            skin += 1
    skin_ratio = skin / max(1, len(pixels))

    # Uniform-background heuristic: count of pixels close to top-left corner colour.
    ref = pixels[0]
    uniform = 0
    for r, g, b in pixels:
        if abs(r - ref[0]) + abs(g - ref[1]) + abs(b - ref[2]) <= 40:
            uniform += 1
    uniform_ratio = uniform / max(1, len(pixels))

    if skin_ratio >= 0.06:
        return "birefnet-portrait"
    if uniform_ratio >= 0.45:
        return "isnet-general-use"
    return DEFAULT_MODEL


def remove_background(
    image_bytes: bytes,
    *,
    model: str = DEFAULT_MODEL,
    alpha_matting: bool = False,
) -> bytes:
    """Remove background; returns PNG bytes with transparency.

    Runs rembg in-process. Raises :class:`BgRemoverError` on failure.
    """
    return remove_background_detailed(
        image_bytes,
        model=model,
        alpha_matting=alpha_matting,
    ).png_bytes


def remove_background_detailed(
    image_bytes: bytes,
    *,
    model: str = DEFAULT_MODEL,
    alpha_matting: bool = False,
) -> BgRemovalOutcome:
    """Like :func:`remove_background` but returns geometry + backend info."""
    if not image_bytes:
        raise BgRemoverError("Empty image bytes.")

    resolved_model = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL

    last_exc: Exception | None = None
    try:
        png_bytes = _in_process_remove(
            image_bytes,
            model=resolved_model,
            alpha_matting=alpha_matting,
        )
        backend = "in_process"
    except _InProcessUnavailable as exc:
        last_exc = exc
        png_bytes = None
        backend = ""
    except BgRemoverError:
        raise
    except Exception as exc:  # noqa: BLE001 - normalise upstream errors
        last_exc = exc
        png_bytes = None
        backend = ""

    if png_bytes is None:
        raise BgRemoverError(f"Background removal failed: {last_exc!r}") from last_exc

    # Inspect the result.
    try:
        with Image.open(io.BytesIO(png_bytes)) as img:
            img.load()
            rgba = img.convert("RGBA")
            bbox = rgba.getchannel("A").getbbox()
            width, height = rgba.size
    except Exception as exc:
        raise BgRemoverError(f"rembg returned invalid image bytes: {exc!r}") from exc

    return BgRemovalOutcome(
        png_bytes=png_bytes,
        width=width,
        height=height,
        model_used=resolved_model,
        alpha_matting=alpha_matting,
        backend=backend,
        bbox=bbox,
    )


def trim_to_alpha(png_bytes: bytes) -> tuple[bytes, tuple[int, int, int, int] | None]:
    """Crop to the bounding box of non-transparent pixels. Returns (png, bbox)."""
    with Image.open(io.BytesIO(png_bytes)) as img:
        img.load()
        rgba = img.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        return png_bytes, None
    trimmed = rgba.crop(bbox)
    buf = io.BytesIO()
    trimmed.save(buf, format="PNG", optimize=True, compress_level=6)
    return buf.getvalue(), bbox


# --------------------------------------------------------------------------- #
# Backend implementations.
# --------------------------------------------------------------------------- #

class _InProcessUnavailable(Exception):
    """Raised when in-process rembg cannot be loaded at all."""


@lru_cache(maxsize=8)
def _get_session(model_name: str):
    try:
        from rembg import new_session
    except Exception as exc:  # noqa: BLE001
        raise _InProcessUnavailable(str(exc)) from exc
    try:
        return new_session(model_name)
    except Exception as exc:  # noqa: BLE001
        raise BgRemoverError(
            f"Could not initialise rembg session for model '{model_name}': {exc!r}"
        ) from exc


def _in_process_remove(image_bytes: bytes, *, model: str, alpha_matting: bool) -> bytes:
    try:
        from rembg import remove
    except Exception as exc:  # noqa: BLE001
        raise _InProcessUnavailable(str(exc)) from exc

    session = _get_session(model)
    kwargs: dict[str, Any] = {"session": session, "post_process_mask": True}
    if alpha_matting:
        kwargs.update(
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=6,
        )
    try:
        return remove(image_bytes, **kwargs)
    except Exception as exc:  # noqa: BLE001
        raise BgRemoverError(f"In-process rembg failed: {exc!r}") from exc


# --------------------------------------------------------------------------- #
# Probing.
# --------------------------------------------------------------------------- #

def probe_backends() -> dict[str, Any]:
    """Inspect which backends are available. Used at startup / diagnostics."""
    info: dict[str, Any] = {"in_process": {"available": False, "error": None, "version": None}}
    try:
        import rembg  # noqa: F401

        info["in_process"]["available"] = True
        info["in_process"]["version"] = getattr(rembg, "__version__", None)
    except Exception as exc:  # noqa: BLE001
        info["in_process"]["error"] = repr(exc)
    return info


__all__ = [
    "BgRemoverError",
    "BgRemovalOutcome",
    "DEFAULT_MODEL",
    "MODELS",
    "auto_select_model",
    "list_models",
    "probe_backends",
    "remove_background",
    "remove_background_detailed",
    "trim_to_alpha",
]
