from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from pinsela.config import get_settings


class TemplatePackNotFoundError(FileNotFoundError):
    pass


class TemplatePackManifestError(ValueError):
    pass


class RenderEngineError(RuntimeError):
    pass


class ManifestTextRule(BaseModel):
    id: str = Field(min_length=1, max_length=256)
    required: bool = False
    max_length: int | None = Field(default=None, ge=1, le=4000)


class ManifestImageRule(BaseModel):
    id: str = Field(min_length=1, max_length=256)
    required: bool = False


class ManifestImageArrayRule(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=32)
    hide_empty: bool = True


class TemplatePackManifestV1(BaseModel):
    version: Literal[1] = 1
    size: dict[str, int] = Field(default_factory=dict)  # width/height (optional but recommended)
    text: dict[str, ManifestTextRule] = Field(default_factory=dict)
    images: dict[str, ManifestImageRule | ManifestImageArrayRule] = Field(default_factory=dict)


@dataclass(frozen=True)
class TemplatePack:
    key: str
    root: Path
    svg_path: Path
    manifest_path: Path
    manifest: dict[str, Any]
    preview_path: Path | None


def _template_packs_root() -> Path:
    settings = get_settings()
    return Path(settings.server_data_root) / "templates"


def load_template_pack(template_key: str) -> TemplatePack:
    """
    Official template pack format:

      <PINSELA_SERVER_DATA_ROOT>/templates/<template_key>/
        - template.svg        (required)
        - manifest.json       (required)
        - preview.png         (optional)
    """
    root = _template_packs_root() / template_key
    svg_path = root / "template.svg"
    manifest_path = root / "manifest.json"
    preview_path = root / "preview.png"

    if not svg_path.exists() or not manifest_path.exists():
        raise TemplatePackNotFoundError(f"Template pack not found or incomplete: {root}")

    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise TemplatePackManifestError(f"Invalid manifest.json: {e}") from e

    # Validate structure (v1 only for now).
    try:
        if (raw or {}).get("version", 1) != 1:
            raise TemplatePackManifestError("Unsupported manifest version (expected 1).")
        TemplatePackManifestV1.model_validate(raw or {})
    except Exception as e:
        raise TemplatePackManifestError(f"Invalid manifest schema: {e}") from e

    return TemplatePack(
        key=template_key,
        root=root,
        svg_path=svg_path,
        manifest_path=manifest_path,
        manifest=raw or {},
        preview_path=(preview_path if preview_path.exists() else None),
    )


_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_ASSET_URL_RE = re.compile(r"/api/assets/([0-9a-fA-F-]{36})")


def _data_uri(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _asset_role_from_tags(tags: list[str] | None) -> str | None:
    for t in tags or []:
        s = str(t or "").strip().lower()
        if s == "role:hero":
            return "hero"
        if s == "role:device":
            return "device"
    return None


def _resolve_image_ref_to_data_uri(ref: Any, *, db: Any | None = None, expected_role: str | None = None) -> str | None:
    """
    Supported refs:
    - data URI (string "data:*")
    - raw UUID / "/api/assets/<uuid>" (requires db to read InputAsset bytes)
    - dict: {"data_uri": "..."} or {"asset_id": "..."} (db required for asset_id)
    """
    if ref is None:
        return None

    if isinstance(ref, dict):
        if isinstance(ref.get("data_uri"), str) and ref["data_uri"].startswith("data:"):
            return ref["data_uri"]
        if "asset_id" in ref:
            ref = ref["asset_id"]
        else:
            return None

    if isinstance(ref, str):
        s = ref.strip()
        if not s:
            return None
        if s.startswith("data:"):
            return s

        m = _ASSET_URL_RE.search(s)
        if m:
            s = m.group(1)

        if _UUID_RE.match(s):
            if db is None:
                raise RenderEngineError("Image ref requires DB access (asset id), but db=None was provided.")
            # Late import to keep this module lightweight for non-image usage.
            import uuid as _uuid

            from pinsela.models import InputAsset

            asset_id = _uuid.UUID(s)
            asset = db.query(InputAsset).filter(InputAsset.id == asset_id).one_or_none()
            if not asset:
                raise RenderEngineError(f"InputAsset not found: {asset_id}")
            role = _asset_role_from_tags(asset.tags if isinstance(asset.tags, list) else [])
            if expected_role and role and role != expected_role:
                raise RenderEngineError(
                    f"InputAsset role mismatch for {asset_id}: expected '{expected_role}', found '{role}'"
                )
            p = Path(asset.server_path)
            if not p.exists():
                raise RenderEngineError(f"InputAsset missing on disk: {p}")
            data = p.read_bytes()
            mime = asset.mime_type or (f"image/{asset.ext}" if asset.ext != "jpg" else "image/jpeg")
            return _data_uri(mime, data)

    return None


def apply_payload_to_svg(svg: bytes | str, payload: dict[str, Any], manifest: dict[str, Any], *, db: Any | None = None) -> bytes:
    """
    Applies payload into an SVG using the template pack manifest (v1).
    - Text slots: manifest["text"][<field_key>].id => element @id
    - Image slots:
      - single: manifest["images"][<field_key>].id
      - array: manifest["images"][<field_key>].ids (fills in order)
    """
    from xml.etree import ElementTree as ET

    svg_bytes = svg.encode("utf-8") if isinstance(svg, str) else svg
    root = ET.fromstring(svg_bytes)

    by_id: dict[str, Any] = {}
    for el in root.iter():
        el_id = el.get("id")
        if el_id:
            by_id[str(el_id)] = el

    def set_display_none(el: Any) -> None:
        el.set("display", "none")

    def set_display_visible(el: Any) -> None:
        if "display" in el.attrib:
            try:
                del el.attrib["display"]
            except Exception:
                pass

    def set_text(el: Any, value: str) -> None:
        # Prefer writing to <tspan> if present (common export format).
        tspans = [c for c in list(el) if str(c.tag).endswith("tspan")]
        if tspans:
            tspans[0].text = value
            for t in tspans[1:]:
                t.text = ""
            return
        el.text = value

    def has_value(v: Any) -> bool:
        if v is None:
            return False
        if isinstance(v, str):
            return bool(v.strip())
        if isinstance(v, list):
            return any(has_value(x) for x in v)
        if isinstance(v, dict):
            return bool(v)
        return True

    def product_field_index(name: str) -> int:
        m = re.match(
            r"^(?:title|titulo|body|descricao|description|subtitle|price|preco|installments|payment_note|product|nome)_?([0-9]+)$",
            str(name or ""),
            flags=re.IGNORECASE,
        )
        if not m:
            return 0
        try:
            n = int(m.group(1))
        except Exception:
            return 0
        return n if n > 0 else 0

    def infer_product_count(*, slot_product_map: list[int], per_product_input: bool, image_items: list[Any]) -> int:
        explicit = payload.get("product_count")
        try:
            n_explicit = int(explicit)
            if n_explicit > 0:
                if slot_product_map:
                    return min(n_explicit, max(slot_product_map))
                return n_explicit
        except Exception:
            pass

        n_from_fields = 0
        for k, v in (payload or {}).items():
            idx = product_field_index(str(k))
            if idx <= 0:
                continue
            if has_value(v):
                n_from_fields = max(n_from_fields, idx)
        if n_from_fields > 0:
            if slot_product_map:
                return min(n_from_fields, max(slot_product_map))
            return n_from_fields

        if image_items:
            if slot_product_map:
                max_map = max(slot_product_map)
                if per_product_input:
                    return min(len(image_items), max_map)
                max_idx = 0
                for i, item in enumerate(image_items):
                    if not has_value(item):
                        continue
                    if i < len(slot_product_map):
                        max_idx = max(max_idx, slot_product_map[i])
                if max_idx > 0:
                    return max_idx
                return min(len(image_items), max_map)
            return len(image_items)
        return 0

    # Text fields
    for field_key, rule in (manifest.get("text") or {}).items():
        if not isinstance(rule, dict):
            continue
        el_id = str(rule.get("id") or "").strip()
        if not el_id:
            continue
        el = by_id.get(el_id)
        if el is None:
            if bool(rule.get("required")):
                raise RenderEngineError(f"Missing required SVG node id for text field '{field_key}': {el_id}")
            continue

        raw = payload.get(field_key)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            if bool(rule.get("required")):
                raise RenderEngineError(f"Missing required payload field: {field_key}")
            set_text(el, "")
            continue

        s = str(raw)
        max_len = rule.get("max_length")
        if isinstance(max_len, int) and max_len > 0 and len(s) > max_len:
            s = s[:max_len]
        set_text(el, s)

    # Images
    images_rules = manifest.get("images") or {}
    device_rule = images_rules.get("device_images") if isinstance(images_rules.get("device_images"), dict) else {}
    device_slot_map_raw = device_rule.get("slot_product_index_map") if isinstance(device_rule, dict) else []
    device_slot_map: list[int] = []
    if isinstance(device_slot_map_raw, list):
        for x in device_slot_map_raw:
            try:
                n = int(x)
            except Exception:
                n = 0
            device_slot_map.append(n if n > 0 else 0)
    raw_device_items = payload.get("device_images")
    if raw_device_items is None:
        device_items: list[Any] = []
    elif isinstance(raw_device_items, list):
        device_items = raw_device_items
    else:
        device_items = [raw_device_items]
    product_count = infer_product_count(
        slot_product_map=[x for x in device_slot_map if x > 0],
        per_product_input=bool(device_rule.get("per_product_input", False)),
        image_items=device_items,
    )

    for field_key, rule in images_rules.items():
        if not isinstance(rule, dict):
            continue

        if "id" in rule:
            el_id = str(rule.get("id") or "").strip()
            if not el_id:
                continue
            el = by_id.get(el_id)
            if el is None:
                if bool(rule.get("required")):
                    raise RenderEngineError(f"Missing required SVG node id for image field '{field_key}': {el_id}")
                continue

            expected_role = "hero" if str(field_key) == "hero_image" else None
            data_uri = _resolve_image_ref_to_data_uri(payload.get(field_key), db=db, expected_role=expected_role)
            if not data_uri:
                if bool(rule.get("required")):
                    raise RenderEngineError(f"Missing required payload image field: {field_key}")
                set_display_none(el)
                continue

            el.set("href", data_uri)
            el.set("{http://www.w3.org/1999/xlink}href", data_uri)
            continue

        if "ids" in rule:
            ids = [str(x) for x in (rule.get("ids") or []) if str(x).strip()]
            if not ids:
                continue
            raw_items = payload.get(field_key)
            if raw_items is None:
                items: list[Any] = []
            elif isinstance(raw_items, list):
                items = raw_items
            else:
                items = [raw_items]

            hide_empty = bool(rule.get("hide_empty", True))
            slot_map_raw = rule.get("slot_product_index_map")
            slot_map: list[int] = []
            if isinstance(slot_map_raw, list):
                for x in slot_map_raw:
                    try:
                        n = int(x)
                    except Exception:
                        n = 0
                    slot_map.append(n if n > 0 else 0)
            use_per_product = bool(rule.get("per_product_input", False)) and bool(slot_map) and len(items) <= max(slot_map)

            for i, el_id in enumerate(ids):
                el = by_id.get(el_id)
                if el is None:
                    continue
                mapped_product_idx = slot_map[i] if i < len(slot_map) else 0
                if mapped_product_idx > 0 and product_count > 0 and mapped_product_idx > product_count:
                    set_display_none(el)
                    continue

                if use_per_product and mapped_product_idx > 0:
                    ref = items[mapped_product_idx - 1] if mapped_product_idx - 1 < len(items) else None
                else:
                    ref = items[i] if i < len(items) else None
                expected_role = "device" if str(field_key) == "device_images" else None
                data_uri = _resolve_image_ref_to_data_uri(ref, db=db, expected_role=expected_role) if ref is not None else None
                if not data_uri:
                    if hide_empty:
                        set_display_none(el)
                    else:
                        el.set("href", "")
                        el.set("{http://www.w3.org/1999/xlink}href", "")
                    continue
                el.set("href", data_uri)
                el.set("{http://www.w3.org/1999/xlink}href", data_uri)

    # Folder templates: hide product frames beyond supplied product count.
    rules = manifest.get("rules") if isinstance(manifest.get("rules"), dict) else {}
    product_frames = rules.get("product_frames") if isinstance(rules.get("product_frames"), dict) else {}
    frame_ids = [str(x).strip() for x in (product_frames.get("ids") or []) if str(x).strip()]
    if frame_ids and product_count > 0:
        for frame_id in frame_ids:
            el = by_id.get(frame_id)
            if el is None:
                continue
            m = re.search(r"([0-9]+)$", frame_id)
            if not m:
                continue
            try:
                idx = int(m.group(1))
            except Exception:
                continue
            if idx <= 0:
                continue
            if idx > product_count:
                set_display_none(el)
            else:
                set_display_visible(el)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _ensure_rsvg_convert() -> str:
    p = shutil.which("rsvg-convert")
    if not p:
        raise RenderEngineError(
            "Missing 'rsvg-convert' (librsvg2-bin). Install it on the server image (apt-get install librsvg2-bin)."
        )
    return p


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=4.0),
    retry=retry_if_exception_type(RenderEngineError),
)
def _render_svg_to_png_bytes(svg_bytes: bytes) -> bytes:
    _ensure_rsvg_convert()
    with tempfile.TemporaryDirectory(prefix="pinsela-render-") as td:
        in_svg = Path(td) / "in.svg"
        out_png = Path(td) / "out.png"
        in_svg.write_bytes(svg_bytes)
        # librsvg rasterizes according to SVG width/height/viewBox.
        proc = subprocess.run(
            ["rsvg-convert", "--format", "png", "--output", str(out_png), str(in_svg)],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0 or not out_png.exists():
            raise RenderEngineError(f"rsvg-convert failed: {proc.stderr.strip() or proc.stdout.strip()}")
        return out_png.read_bytes()


def _validate_image_bytes(data: bytes, *, min_width: int = 64, min_height: int = 64) -> tuple[int, int]:
    from io import BytesIO

    from PIL import Image

    im = Image.open(BytesIO(data))
    im.load()
    w, h = im.size
    if w < min_width or h < min_height:
        raise RenderEngineError(f"Rendered image too small: {w}x{h} (min {min_width}x{min_height})")
    return int(w), int(h)


def render_svg_to_png_jpg(svg: bytes | str, *, expected_size: tuple[int, int] | None = None) -> dict[str, tuple[bytes, dict[str, Any]]]:
    """
    Renders SVG to:
    - PNG (always)
    - JPG (composited on white background)
    - WEBP (optional; only if Pillow has WEBP support at runtime)
    """
    svg_bytes = svg.encode("utf-8") if isinstance(svg, str) else svg

    png = _render_svg_to_png_bytes(svg_bytes)
    w, h = _validate_image_bytes(png)
    if expected_size is not None and (int(w), int(h)) != (int(expected_size[0]), int(expected_size[1])):
        raise RenderEngineError(f"Rendered image has unexpected size: {w}x{h} (expected {expected_size[0]}x{expected_size[1]})")
    # Minimum bytes sanity check (helps catch empty renders).
    min_bytes = 512
    if expected_size and (expected_size[0] * expected_size[1]) >= (1080 * 1080):
        min_bytes = 10_000
    if len(png) < min_bytes:
        raise RenderEngineError(f"Rendered PNG too small in bytes: {len(png)} (min {min_bytes})")
    png_meta = {"width": w, "height": h, "bytes": len(png), "sha256": hashlib.sha256(png).hexdigest()}

    # Convert to JPG via Pillow (keeps renderer dependency minimal).
    from io import BytesIO

    from PIL import Image

    im = Image.open(BytesIO(png))
    im.load()
    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im2 = bg
    else:
        im2 = im.convert("RGB")

    b = BytesIO()
    im2.save(b, format="JPEG", quality=92, optimize=True)
    jpg = b.getvalue()
    jpg_meta = {"width": w, "height": h, "bytes": len(jpg), "sha256": hashlib.sha256(jpg).hexdigest()}

    out: dict[str, tuple[bytes, dict[str, Any]]] = {"png": (png, png_meta), "jpg": (jpg, jpg_meta)}

    # Optional WEBP
    try:
        b2 = BytesIO()
        im2.save(b2, format="WEBP", quality=90, method=6)
        webp = b2.getvalue()
        webp_meta = {"width": w, "height": h, "bytes": len(webp), "sha256": hashlib.sha256(webp).hexdigest()}
        out["webp"] = (webp, webp_meta)
    except Exception:
        pass

    return out
