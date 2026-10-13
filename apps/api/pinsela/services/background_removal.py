from __future__ import annotations

import base64
import binascii
import hashlib
import io
import os
import re
import urllib.parse
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageChops, ImageFilter, ImageOps
from sqlalchemy.orm import Session

from pinsela.models import InputAsset


MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 48_000_000
# Most images are photos of people, so the default is a
# human-segmentation model that keeps the whole subject (including light-coloured
# clothing) instead of the product-tuned ``isnet-general-use`` model, which was
# silently dropping low-contrast garments. See ``_auto_select_model``.
DEFAULT_MODEL_NAME = "u2net_human_seg"  # person / portrait / body
PRODUCT_MODEL_NAME = "isnet-general-use"  # product/object on a clean background
GENERIC_MODEL_NAME = "u2net"  # everything else
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_ASSET_URL_RE = re.compile(r"^(?:asset://|(?:https?://[^/]+)?(?:/v2)?/api/assets/)([0-9a-fA-F-]{36})(?:[/?#].*)?$", re.IGNORECASE)
_DATA_URI_RE = re.compile(r"^data:([^;,]+)?(?:;(base64))?,(.*)$", re.IGNORECASE | re.DOTALL)


class BackgroundRemovalError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResolvedImageSource:
    data: bytes
    source_kind: str
    mime_type: str | None = None
    name: str | None = None
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class BackgroundRemovalResult:
    png_bytes: bytes
    width: int
    height: int
    sha256: str
    model_name: str


def derive_background_removed_name(name: str | None) -> str:
    base = str(name or "").strip()
    if not base:
        return "Image (no background)"
    if base.lower().endswith(" (no background)"):
        return base
    return f"{base} (no background)"


def merge_background_removed_tags(*tag_groups: list[str] | tuple[str, ...] | None) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for tags in tag_groups:
        for tag in tags or []:
            normalized = str(tag or "").strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(normalized)
    if "bg-removed" not in seen:
        merged.append("bg-removed")
    return merged


def resolve_image_source(source: str, *, db: Session) -> ResolvedImageSource:
    raw = str(source or "").strip()
    if not raw:
        raise BackgroundRemovalError("Invalid image: empty source.")

    data_uri = _resolve_data_uri_source(raw)
    if data_uri is not None:
        mime_type, data = data_uri
        return ResolvedImageSource(data=data, source_kind="data_uri", mime_type=mime_type)

    asset_source = _resolve_asset_source(raw, db=db)
    if asset_source is not None:
        return asset_source

    if raw.lower().startswith(("http://", "https://")):
        return _resolve_remote_url_source(raw)

    raise BackgroundRemovalError("Unsupported source format for background removal.")


def remove_background_image(
    source: ResolvedImageSource,
    *,
    model_name: str | None = None,
    alpha_matting: bool = False,
) -> BackgroundRemovalResult:
    normalized_input = _load_image(source.data)
    prepared_png = _encode_png(normalized_input)
    original_alpha = normalized_input.getchannel("A")

    # An explicit model (or the env override) is honoured as-is; otherwise we
    # auto-route on image content and keep a single cheap fallback in case the
    # heuristic mis-routes (e.g. a product photo that the person model can't
    # segment). The fallback only ever loads one extra model, and only when the
    # primary returns an empty cutout — important on a memory-tight machine.
    explicit_model = _explicit_model_name(model_name)
    attempts = [explicit_model] if explicit_model else _model_attempt_chain(
        _auto_select_model(normalized_input)
    )

    last_error: Exception | None = None
    for candidate in attempts:
        try:
            cutout_bytes = _run_rembg_pipeline(
                prepared_png, model_name=candidate, alpha_matting=alpha_matting
            )
        except BackgroundRemovalError as exc:
            last_error = exc
            continue
        cutout = _load_image(cutout_bytes)
        refined = _refine_cutout(cutout, original_alpha=original_alpha)
        if refined.getchannel("A").getbbox() is not None:
            png_bytes = _encode_png(refined)
            return BackgroundRemovalResult(
                png_bytes=png_bytes,
                width=refined.width,
                height=refined.height,
                sha256=hashlib.sha256(png_bytes).hexdigest(),
                model_name=candidate,
            )

    if last_error is not None:
        raise last_error
    raise BackgroundRemovalError(
        "The image was processed, but no extractable object was found."
    )


def _explicit_model_name(model_name: str | None) -> str:
    """An explicitly requested model, or the env override. Empty string = auto."""
    explicit = str(model_name or "").strip()
    if explicit:
        return explicit
    return str(os.getenv("PINSELA_REMOVE_BG_MODEL") or "").strip()


def _model_attempt_chain(primary: str) -> list[str]:
    """The primary model plus at most one fallback (keeps memory bounded)."""
    chain = [primary]
    for candidate in (PRODUCT_MODEL_NAME, GENERIC_MODEL_NAME, DEFAULT_MODEL_NAME):
        if candidate not in chain:
            chain.append(candidate)
            break
    return chain


def _auto_select_model(image: Image.Image) -> str:
    """Pick a segmentation model from image content (no heavy deps, no cv2).

    * Lots of skin tones → a person → ``u2net_human_seg`` (keeps the whole body
      and light clothing, which the product model drops).
    * Mostly-uniform background → a product/object on a clean card → ``isnet``.
    * Otherwise → the balanced ``u2net``.

    Operates on a 64x64 thumbnail so it costs microseconds.
    """
    try:
        small = image.convert("RGB").resize((64, 64))
        pixels = list(small.getdata())
    except Exception:
        return DEFAULT_MODEL_NAME

    n = max(1, len(pixels))
    skin = sum(
        1
        for r, g, b in pixels
        if 95 <= r <= 245 and r > g >= b and (r - b) >= 15 and (r - g) <= 80
    )
    ref = pixels[0]
    uniform = sum(
        1
        for r, g, b in pixels
        if abs(r - ref[0]) + abs(g - ref[1]) + abs(b - ref[2]) <= 40
    )

    if skin / n >= 0.06:
        return DEFAULT_MODEL_NAME  # u2net_human_seg
    if uniform / n >= 0.45:
        return PRODUCT_MODEL_NAME  # isnet-general-use
    return GENERIC_MODEL_NAME  # u2net


def _resolve_data_uri_source(source: str) -> tuple[str | None, bytes] | None:
    match = _DATA_URI_RE.match(source)
    if not match:
        return None
    mime_type = (match.group(1) or "").strip().lower() or None
    is_base64 = bool(match.group(2))
    payload = match.group(3) or ""
    try:
        data = base64.b64decode(payload, validate=False) if is_base64 else urllib.parse.unquote_to_bytes(payload)
    except (ValueError, binascii.Error) as exc:
        raise BackgroundRemovalError("Invalid image data URL.") from exc
    _ensure_image_size_limit(len(data))
    return mime_type, data


def _resolve_asset_source(source: str, *, db: Session) -> ResolvedImageSource | None:
    candidate = source
    asset_match = _ASSET_URL_RE.match(candidate)
    if asset_match:
        candidate = asset_match.group(1)
    if not _UUID_RE.match(candidate):
        return None

    asset_id = uuid.UUID(candidate)
    asset = db.query(InputAsset).filter(InputAsset.id == asset_id).one_or_none()
    if not asset:
        raise BackgroundRemovalError("The original asset was not found on the server.")

    path = Path(asset.server_path)
    if not path.exists() or not path.is_file():
        raise BackgroundRemovalError("The original asset file is not available on the server.")

    data = path.read_bytes()
    _ensure_image_size_limit(len(data))
    return ResolvedImageSource(
        data=data,
        source_kind="asset",
        mime_type=asset.mime_type,
        name=asset.name,
        tags=tuple(asset.tags or []),
    )


def _resolve_remote_url_source(url: str) -> ResolvedImageSource:
    from pinsela.security import fetch_public_url

    headers = {"User-Agent": "PinselaBackgroundRemoval/1.0"}
    try:
        # Public hosts only (anti-SSRF); redirects revalidated hop by hop.
        payload, content_type = fetch_public_url(
            url, timeout=60.0, max_bytes=MAX_IMAGE_BYTES, headers=headers
        )
    except ValueError as exc:
        raise BackgroundRemovalError(f"URL not allowed or too large ({exc}).") from exc
    except httpx.HTTPError as exc:
        raise BackgroundRemovalError("Could not download the original image to remove the background.") from exc

    _ensure_image_size_limit(len(payload))
    mime_type = content_type.lower() or None
    parsed = urllib.parse.urlparse(url)
    name = Path(parsed.path).stem or None
    return ResolvedImageSource(data=payload, source_kind="url", mime_type=mime_type, name=name)


def _ensure_image_size_limit(size_bytes: int) -> None:
    if size_bytes <= 0:
        raise BackgroundRemovalError("Empty image.")
    if size_bytes > MAX_IMAGE_BYTES:
        raise BackgroundRemovalError("Image too large. The limit is 25 MB.")


def _load_image(data: bytes) -> Image.Image:
    _ensure_image_size_limit(len(data))
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            normalized = ImageOps.exif_transpose(image).convert("RGBA")
    except Exception as exc:
        raise BackgroundRemovalError("Invalid or corrupted image.") from exc

    if normalized.width <= 0 or normalized.height <= 0:
        raise BackgroundRemovalError("Invalid image: missing dimensions.")
    if normalized.width * normalized.height > MAX_IMAGE_PIXELS:
        raise BackgroundRemovalError("Image too large to process safely.")
    return normalized


def _encode_png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True, compress_level=6)
    return out.getvalue()


def _refine_cutout(cutout: Image.Image, *, original_alpha: Image.Image | None = None) -> Image.Image:
    rgba = cutout.convert("RGBA")
    alpha = rgba.getchannel("A")
    if original_alpha is not None:
        # Respect any transparency the source already had (e.g. PNG cut-outs).
        alpha = ImageChops.multiply(alpha, original_alpha.convert("L"))

    # A light feather just anti-aliases the cut edge. The old code eroded a
    # contrast-boosted edge band, which carved into the subject and left halos;
    # ``post_process_mask`` in the rembg pass already cleans speckle, so we only
    # need a gentle 0.6px blur here.
    refined_alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.6))

    result = rgba.copy()
    result.putalpha(refined_alpha)
    return result


# Cap at two resident model sessions (~350 MB) so background removal never
# starves the rest of the machine — this runs on an 8 GB Mac.
@lru_cache(maxsize=2)
def _get_rembg_session(model_name: str):
    try:
        from rembg import new_session
    except Exception as exc:
        raise BackgroundRemovalError(
            "The background removal dependency is not available on the backend. Install `rembg` and `onnxruntime`."
        ) from exc

    try:
        return new_session(model_name)
    except Exception as exc:
        raise BackgroundRemovalError(f"Could not initialize the background removal model '{model_name}'.") from exc


def _run_rembg_pipeline(prepared_png: bytes, *, model_name: str, alpha_matting: bool = False) -> bytes:
    try:
        from rembg import remove
    except Exception as exc:
        raise BackgroundRemovalError(
            "The background removal dependency is not available on the backend. Install `rembg` and `onnxruntime`."
        ) from exc

    session = _get_rembg_session(model_name)
    # Single pass by default. ``post_process_mask`` cleans speckle cheaply.
    # Alpha matting (closed-form, runs at full resolution) is opt-in only: it is
    # 5-20x slower and, with an aggressive trimap, erodes legitimate subject
    # pixels. When requested we use a small erode size so it refines hair edges
    # instead of eating into the subject.
    kwargs: dict[str, Any] = {"session": session, "post_process_mask": True}
    if alpha_matting:
        kwargs.update(
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=2,
        )

    try:
        return remove(prepared_png, **kwargs)
    except Exception as exc:
        # Defensive retry with the plainest possible config before giving up.
        try:
            return remove(prepared_png, session=session)
        except Exception:
            raise BackgroundRemovalError("Failed to segment the image to remove the background.") from exc
