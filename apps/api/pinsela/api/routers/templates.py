from __future__ import annotations

import math

import base64
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from pinsela.auth import require_admin
from pinsela.config import get_settings
from pinsela.db import db_session
from pinsela.models import Artwork, TemplateDefinition
from pinsela.schemas import TemplateLiteOut, TemplateOut
from pinsela.services.render_engine import TemplatePackManifestV1
from pinsela.services.draft_pack_queue import enqueue_draft_pack_job
from pinsela.services import live_bus, session_snapshots
from pinsela.services.render_engine_native import NativeRenderEngineError, simulate_native_layout
from pinsela.services.pinsela_package import (
    PINSELA_FILENAME,
    read_pinsela_package,
    write_pinsela_package,
)
from pinsela.services.template_native import (
    build_mapping_from_native_doc,
    build_schema_from_native_doc,
    validate_native_doc,
)


router = APIRouter(prefix="/api/templates", tags=["templates"], dependencies=[Depends(require_admin)])
_TEMPLATE_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
NATIVE_PROJECT_ENGINE_TYPE = "pinsela_native_v1"
_SYNC_INTERVAL_SECONDS = 2.0
_SYNC_LAST_RUN: dict[str, float] = {"templates": 0.0, "projects": 0.0}
_SYNC_LAST_STORAGE_FP: dict[str, str | None] = {"templates": None, "projects": None}
_LIST_RESPONSE_CACHE: dict[tuple[str, bool], dict[str, Any]] = {}


class TemplateUpdate(BaseModel):
    name: str | None = None
    schema_json: dict[str, Any] | None = None
    figma_mapping_json: dict[str, Any] | None = None


class TemplatePackUploadRequest(BaseModel):
    template_key: str
    template_name: str | None = None
    template_svg_b64: str
    manifest_json: dict[str, Any]
    preview_png_b64: str | None = None
    source: str | None = None


class TemplateNativeUploadRequest(BaseModel):
    template_key: str
    template_name: str | None = None
    project_name: str | None = None
    doc_json: dict[str, Any]
    preview_png_b64: str | None = None
    source: str | None = None


class TemplateNativeDraftRequest(BaseModel):
    doc_json: dict[str, Any]
    preview_png_b64: str | None = None
    source: str | None = None


class TemplateNativeAutosaveDeltaRequest(BaseModel):
    doc_json: dict[str, Any]
    preview_png_b64: str | None = None
    source: str | None = None
    delta_id: str | None = None
    sync_current: bool = False


class TemplateNativePublishRequest(BaseModel):
    use_draft: bool = True
    doc_json: dict[str, Any] | None = None
    preview_png_b64: str | None = None
    source: str | None = None
    template_name: str | None = None
    project_name: str | None = None


class TemplateNativeRestoreRequest(BaseModel):
    pack_version: str


class TemplateNativeSimulateRequest(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)
    doc_json: dict[str, Any] | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _template_packs_root() -> Path:
    settings = get_settings()
    p = Path(settings.server_data_root) / "templates"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _project_packs_root() -> Path:
    settings = get_settings()
    p = Path(settings.server_data_root) / "projects"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _compat_project_packs_root() -> Path:
    # Backward compatibility: historical project-native docs were stored under templates/.
    return _template_packs_root()


def _project_root(project_key: str) -> Path:
    return _project_packs_root() / project_key


def _compat_project_root(project_key: str) -> Path:
    return _compat_project_packs_root() / project_key


def _normalize_template_key(raw: str) -> str:
    key = (raw or "").strip().lower()
    if not _TEMPLATE_KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Invalid template_key (use [a-z0-9_-], up to 64 chars).")
    return key


def _normalize_template_name(raw: str | None, *, fallback_key: str) -> str:
    name = (raw or "").strip()
    if not name:
        name = fallback_key
    return name[:128]


def _label_from_key(key: str) -> str:
    s = re.sub(r"[_\-]+", " ", (key or "").strip()).strip()
    if not s:
        return key
    return s[:1].upper() + s[1:]


def _decode_b64(name: str, b64: str, *, max_bytes: int) -> bytes:
    try:
        out = base64.b64decode((b64 or "").encode("ascii"), validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid {name} (base64).")
    if not out:
        raise HTTPException(status_code=400, detail=f"{name} is empty.")
    if len(out) > max_bytes:
        raise HTTPException(status_code=400, detail=f"{name} exceeds the limit of {max_bytes} bytes.")
    return out


def _validate_manifest_svg_bindings(svg_bytes: bytes, manifest: dict[str, Any]) -> None:
    from xml.etree import ElementTree as ET

    try:
        root = ET.fromstring(svg_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid template_svg_b64 (SVG parse): {e}")

    by_id: dict[str, Any] = {}
    for el in root.iter():
        el_id = el.get("id")
        if el_id:
            by_id[str(el_id)] = el

    def _is_text_editable(el: Any) -> bool:
        tag = str(getattr(el, "tag", "") or "")
        if tag.endswith("text") or tag.endswith("tspan"):
            return True
        for d in el.iter():
            t = str(getattr(d, "tag", "") or "")
            if t.endswith("text") or t.endswith("tspan"):
                return True
        return False

    errors: list[str] = []
    text = manifest.get("text") if isinstance(manifest.get("text"), dict) else {}
    for field_key, raw_rule in text.items():
        field = str(field_key or "").strip()
        rule = raw_rule if isinstance(raw_rule, dict) else {}
        node_id = str(rule.get("id") or "").strip()
        if not field or not node_id:
            continue
        el = by_id.get(node_id)
        if el is None:
            errors.append(f"text.{field}: id '{node_id}' not found in the SVG.")
            continue
        if not _is_text_editable(el):
            errors.append(
                f"text.{field}: id '{node_id}' is not an editable text node "
                f"(export with svgOutlineText=false and svgIdAttribute=true)."
            )

    if errors:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "template_svg/manifest are incompatible for dynamic rendering.",
                "errors": errors[:30],
            },
        )


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".tmp-{path.name}-{uuid.uuid4().hex}"
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def _atomic_write_text(path: Path, text: str) -> None:
    _atomic_write_bytes(path, text.encode("utf-8"))


def _next_pack_version(versions_root: Path) -> int:
    versions_root.mkdir(parents=True, exist_ok=True)
    n = 0
    for child in versions_root.iterdir():
        if not child.is_dir():
            continue
        m = re.match(r"^v([0-9]+)$", child.name)
        if not m:
            continue
        n = max(n, int(m.group(1)))
    return n + 1


def _read_json_object(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return raw if isinstance(raw, dict) else None


def _native_root(template_key: str) -> Path:
    return _project_root(template_key) / "native"


def _native_versions_root(template_key: str) -> Path:
    return _native_root(template_key) / "versions"


def _native_draft_root(template_key: str) -> Path:
    return _native_root(template_key) / "draft"


def _native_compat_root(template_key: str) -> Path:
    return _compat_project_root(template_key) / "native"


def _copy_compat_native_project_if_missing(template_key: str) -> None:
    current_root = _native_root(template_key)
    compat_root = _native_compat_root(template_key)
    if current_root.exists():
        return
    if not compat_root.exists():
        return
    try:
        current_root.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(compat_root, current_root)
    except FileExistsError:
        pass
    except Exception:
        # Non-fatal compatibility fallback: reads still check compat path.
        pass


def _native_root_for_read(template_key: str) -> Path:
    _copy_compat_native_project_if_missing(template_key)
    current_root = _native_root(template_key)
    if current_root.exists():
        return current_root
    compat_root = _native_compat_root(template_key)
    if compat_root.exists():
        return compat_root
    return current_root


def _native_versions_root_for_read(template_key: str) -> Path:
    root = _native_root_for_read(template_key)
    return root / "versions"


def _native_draft_root_for_read(template_key: str) -> Path:
    root = _native_root_for_read(template_key)
    return root / "draft"


def _native_version_dir_for_read(template_key: str, pack_version: str) -> Path:
    current = _native_versions_root(template_key) / pack_version
    if current.exists() and current.is_dir():
        return current
    compat = _native_compat_root(template_key) / "versions" / pack_version
    if compat.exists() and compat.is_dir():
        return compat
    return current


def _read_native_doc_from_dir(root: Path) -> dict[str, Any] | None:
    package = read_pinsela_package(root / PINSELA_FILENAME)
    if package and isinstance(package.get("doc_json"), dict):
        return package["doc_json"]
    return _read_json_object(root / "doc.json")


def _read_native_preview_from_dir(root: Path) -> bytes | None:
    preview_file = _read_optional_preview(root / "preview.png")
    if preview_file is not None:
        return preview_file
    package = read_pinsela_package(root / PINSELA_FILENAME)
    if not package:
        return None
    preview = package.get("preview_png")
    return preview if isinstance(preview, (bytes, bytearray)) else None


def _write_native_pinsela(
    root: Path,
    *,
    doc_json: dict[str, Any],
    schema_json: dict[str, Any] | None = None,
    mapping_json: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    preview_bytes: bytes | None = None,
) -> None:
    write_pinsela_package(
        root / PINSELA_FILENAME,
        doc_json=doc_json,
        schema_json=schema_json,
        mapping_json=mapping_json,
        metadata=metadata,
        preview_png=preview_bytes,
    )


def _read_optional_preview(path: Path) -> bytes | None:
    if not path.exists() or not path.is_file():
        return None
    try:
        return path.read_bytes()
    except Exception:
        return None


def _parse_pack_version(raw: str) -> str:
    v = str(raw or "").strip().lower()
    if not re.match(r"^v[0-9]+$", v):
        raise HTTPException(status_code=400, detail="Invalid pack_version (e.g. v3).")
    return v


def _sync_bucket_roots(bucket: str) -> list[Path]:
    if bucket == "templates":
        return [_template_packs_root()]
    if bucket == "projects":
        roots: list[Path] = []
        for candidate in (_project_packs_root(), _compat_project_packs_root()):
            if any(str(existing) == str(candidate) for existing in roots):
                continue
            roots.append(candidate)
        return roots
    return []


def _append_tree_mtime_fingerprint(hasher: "hashlib._Hash", root: Path, *, max_depth: int = 4) -> None:
    def walk(path: Path, rel: str, depth: int) -> None:
        try:
            st = path.stat()
        except OSError:
            return

        is_dir = path.is_dir()
        hasher.update(rel.encode("utf-8", "ignore"))
        hasher.update(b"\0d" if is_dir else b"\0f")
        hasher.update(str(int(getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000)))).encode("ascii"))
        if not is_dir:
            hasher.update(b"\0")
            hasher.update(str(int(getattr(st, "st_size", 0))).encode("ascii"))
            return
        if depth >= max_depth:
            return
        try:
            children = sorted(path.iterdir(), key=lambda item: item.name)
        except OSError:
            return
        for child in children:
            child_rel = f"{rel}/{child.name}" if rel else child.name
            walk(child, child_rel, depth + 1)

    walk(root, "", 0)


def _bucket_storage_mtime_fingerprint(bucket: str) -> str:
    hasher = hashlib.blake2b(digest_size=16)
    roots = _sync_bucket_roots(bucket)
    for root in sorted(roots, key=lambda p: str(p)):
        hasher.update(b"ROOT:")
        hasher.update(str(root).encode("utf-8", "ignore"))
        hasher.update(b"\n")
        _append_tree_mtime_fingerprint(hasher, root, max_depth=4)
        hasher.update(b"\n")
    return hasher.hexdigest()


def _sync_due(bucket: str, *, force: bool = False) -> bool:
    now = time.monotonic()
    if force:
        current_fp = _bucket_storage_mtime_fingerprint(bucket)
        _SYNC_LAST_RUN[bucket] = now
        _SYNC_LAST_STORAGE_FP[bucket] = current_fp
        return True
    previous_fp = _SYNC_LAST_STORAGE_FP.get(bucket)
    last = float(_SYNC_LAST_RUN.get(bucket, 0.0))
    if previous_fp is not None and (now - last) < _SYNC_INTERVAL_SECONDS:
        return False
    current_fp = _bucket_storage_mtime_fingerprint(bucket)
    _SYNC_LAST_RUN[bucket] = now
    if previous_fp is None or previous_fp != current_fp:
        _SYNC_LAST_STORAGE_FP[bucket] = current_fp
        return True
    return False


def _normalize_doc_image_refs(doc_json: dict[str, Any]) -> dict[str, Any]:
    def _asset_path_for_uuid(asset_uuid: str) -> str:
        return f"/api/assets/{asset_uuid}"

    def _extract_asset_uuid(raw: str) -> str | None:
        value = str(raw or "").strip()
        if not value:
            return None
        try:
            return str(uuid.UUID(value))
        except Exception:
            pass
        m = re.search(r"/api/assets/([0-9a-fA-F-]{36})$", value)
        if not m:
            return None
        try:
            return str(uuid.UUID(m.group(1)))
        except Exception:
            return None

    nodes = doc_json.get("nodes")
    if not isinstance(nodes, list):
        return doc_json
    for raw_node in nodes:
        if not isinstance(raw_node, dict):
            continue
        image_asset_id = raw_node.get("image_asset_id")
        image_src = raw_node.get("image_src")
        if isinstance(image_asset_id, str) and image_asset_id.strip():
            normalized_asset_id = _extract_asset_uuid(image_asset_id.strip())
            if normalized_asset_id:
                raw_node["image_asset_id"] = normalized_asset_id
                if not (isinstance(image_src, str) and image_src.strip()):
                    raw_node["image_src"] = _asset_path_for_uuid(normalized_asset_id)
                else:
                    src_asset_id = _extract_asset_uuid(image_src)
                    if src_asset_id == normalized_asset_id and str(image_src).strip() != _asset_path_for_uuid(normalized_asset_id):
                        raw_node["image_src"] = _asset_path_for_uuid(normalized_asset_id)
            continue
        if isinstance(image_src, str) and image_src.strip():
            parsed_asset_id = _extract_asset_uuid(image_src.strip())
            if parsed_asset_id:
                raw_node["image_asset_id"] = parsed_asset_id
                if str(image_src).strip() != _asset_path_for_uuid(parsed_asset_id):
                    raw_node["image_src"] = _asset_path_for_uuid(parsed_asset_id)
    return doc_json


def _to_template_out(row: TemplateDefinition) -> TemplateOut:
    return TemplateOut(
        id=row.id,
        key=row.key,
        name=row.name,
        engine_type=row.engine_type or "svg_manifest_v1",
        locked=bool(row.locked),
        schema_json=row.schema_json,
        figma_mapping_json=row.figma_mapping_json,
    )


def _canvas_dim(value: Any) -> int | None:
    try:
        num = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(num):
        return None
    dim = int(round(num))
    return dim if 1 <= dim <= 20000 else None


def _canvas_size_of(row: TemplateDefinition) -> tuple[int | None, int | None]:
    doc = row.engine_doc_json if isinstance(row.engine_doc_json, dict) else {}
    canvas = doc.get("canvas") if isinstance(doc.get("canvas"), dict) else {}
    w, h = _canvas_dim(canvas.get("width")), _canvas_dim(canvas.get("height"))
    return (w, h) if w and h else (None, None)


def _to_template_lite_out(row: TemplateDefinition) -> TemplateLiteOut:
    canvas_width, canvas_height = _canvas_size_of(row)
    return TemplateLiteOut(
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        id=row.id,
        key=row.key,
        name=row.name,
        engine_type=row.engine_type or "svg_manifest_v1",
        locked=bool(row.locked),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _template_definitions_db_marker(db: Session) -> str:
    count, max_updated = db.query(
        func.count(TemplateDefinition.id),
        func.max(TemplateDefinition.updated_at),
    ).one()
    count_num = int(count or 0)
    if isinstance(max_updated, datetime):
        updated_marker = max_updated.isoformat()
    else:
        updated_marker = ""
    return f"{count_num}:{updated_marker}"


def _get_list_cache(
    scope: str,
    *,
    lite: bool,
    db_marker: str,
    templates_fp: str | None = None,
    projects_fp: str | None = None,
) -> list[TemplateOut] | list[TemplateLiteOut] | None:
    entry = _LIST_RESPONSE_CACHE.get((scope, bool(lite)))
    if not entry:
        return None
    if str(entry.get("db_marker") or "") != db_marker:
        return None
    if scope == "templates":
        if str(entry.get("templates_fp") or "") != str(templates_fp or ""):
            return None
        if str(entry.get("projects_fp") or "") != str(projects_fp or ""):
            return None
    if scope == "projects":
        if str(entry.get("projects_fp") or "") != str(projects_fp or ""):
            return None
    payload = entry.get("payload")
    if not isinstance(payload, list):
        return None
    return payload  # immutable for our usage; safe to reuse


def _set_list_cache(
    scope: str,
    *,
    lite: bool,
    db_marker: str,
    payload: list[TemplateOut] | list[TemplateLiteOut],
    templates_fp: str | None = None,
    projects_fp: str | None = None,
) -> None:
    _LIST_RESPONSE_CACHE[(scope, bool(lite))] = {
        "db_marker": db_marker,
        "templates_fp": templates_fp,
        "projects_fp": projects_fp,
        "payload": payload,
    }


def _save_native_draft(
    *,
    key: str,
    doc_json: dict[str, Any],
    preview_bytes: bytes | None,
    source: str | None,
    enqueue_pack: bool,
) -> tuple[dict[str, Any], str | None]:
    draft_root = _native_draft_root(key)
    draft_root.mkdir(parents=True, exist_ok=True)
    meta = {
        "template_key": key,
        "project_key": key,
        "updated_at": _now_iso(),
        "source": (source or "pinsela-pinsela").strip()[:128] or "pinsela-pinsela",
    }
    _atomic_write_text(draft_root / "doc.json", json.dumps(doc_json, ensure_ascii=False, indent=2))
    _atomic_write_text(draft_root / "pack.meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
    if preview_bytes is not None:
        _atomic_write_bytes(draft_root / "preview.png", preview_bytes)

    queued_job_id: str | None = None
    if enqueue_pack:
        queued_job_id = enqueue_draft_pack_job(template_key=key, draft_root=draft_root)
    else:
        _write_native_pinsela(
            draft_root,
            doc_json=doc_json,
            metadata=meta,
            preview_bytes=preview_bytes,
        )

    payload = {
        "ok": True,
        "template_key": key,
        "status": "draft_saved",
        "updated_at": meta["updated_at"],
        "packaging": "queued" if enqueue_pack else "synced",
        "paths": {"draft": str(draft_root), "draft_pinsela": str(draft_root / PINSELA_FILENAME)},
    }
    return payload, queued_job_id


def _sync_native_current_doc(
    *,
    template_key: str,
    doc_json: dict[str, Any],
    preview_bytes: bytes | None,
    source: str | None,
    db: Session | None = None,
) -> dict[str, Any]:
    schema_json = build_schema_from_native_doc(doc_json)
    figma_mapping_json = build_mapping_from_native_doc(doc_json)
    now_iso = _now_iso()
    native_root = _native_root(template_key)
    native_root.mkdir(parents=True, exist_ok=True)

    template_name = template_key
    tpl = None
    if db is not None:
        tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == template_key).one_or_none()
        if tpl is not None and str(tpl.name or "").strip():
            template_name = str(tpl.name).strip()
    if tpl is None:
        current_meta = _read_json_object(native_root / "pack.meta.json") or {}
        template_name = str(current_meta.get("template_name") or current_meta.get("project_name") or template_name).strip() or template_key

    # Per-session history (spec §6): if the previous session closed (idle) or hit
    # the cap, snapshot the current LIVE state into history BEFORE overwriting.
    _now = time.time()
    if session_snapshots.should_snapshot(template_key, _now):
        _prev = _read_native_doc_from_dir(_native_root_for_read(template_key))
        if isinstance(_prev, dict) and _prev:
            try:
                _prev_valid = validate_native_doc(dict(_prev))
            except Exception:
                _prev_valid = None
            if _prev_valid is not None:
                _publish_native_doc(
                    db=db,
                    template_key=template_key,
                    template_name=template_name,
                    doc_json=_prev_valid,
                    preview_bytes=_read_native_preview_from_dir(_native_root_for_read(template_key)),
                    source="session-snapshot",
                    authors=session_snapshots.session_authors(template_key),
                )
                session_snapshots.gc_versions(_native_versions_root(template_key), _now)
        session_snapshots.reset_after_snapshot(template_key, _now)
    session_snapshots.note_edit(template_key, _now, session_snapshots.classify_author(source or ""))

    metadata = {
        "template_key": template_key,
        "project_key": template_key,
        "template_name": template_name,
        "project_name": template_name,
        "updated_at": now_iso,
        "source": (source or "autosave-delta").strip()[:128] or "autosave-delta",
        "engine_type": NATIVE_PROJECT_ENGINE_TYPE,
    }
    _atomic_write_text(native_root / "doc.json", json.dumps(doc_json, ensure_ascii=False, indent=2))
    _atomic_write_text(native_root / "schema.json", json.dumps(schema_json, ensure_ascii=False, indent=2))
    _atomic_write_text(native_root / "mapping.json", json.dumps(figma_mapping_json, ensure_ascii=False, indent=2))
    _atomic_write_text(native_root / "pack.meta.json", json.dumps(metadata, ensure_ascii=False, indent=2))
    if preview_bytes is not None:
        _atomic_write_bytes(native_root / "preview.png", preview_bytes)
    _write_native_pinsela(
        native_root,
        doc_json=doc_json,
        schema_json=schema_json,
        mapping_json=figma_mapping_json,
        metadata=metadata,
        preview_bytes=preview_bytes,
    )

    if db is not None:
        if tpl is None:
            tpl = TemplateDefinition(
                key=template_key,
                name=template_name,
                engine_type=NATIVE_PROJECT_ENGINE_TYPE,
                engine_doc_json=doc_json,
                locked=True,
                schema_json=schema_json,
                figma_mapping_json=figma_mapping_json,
            )
            db.add(tpl)
        else:
            tpl.name = template_name
            tpl.engine_type = NATIVE_PROJECT_ENGINE_TYPE
            tpl.engine_doc_json = doc_json
            tpl.locked = True
            tpl.schema_json = schema_json
            tpl.figma_mapping_json = figma_mapping_json
        db.commit()

    # Live (spec §5): tells the open editor that the live version changed.
    live_bus.publish_event("doc-changed", key=template_key, updated_at=now_iso)

    return {
        "ok": True,
        "template_key": template_key,
        "updated_at": now_iso,
        "paths": {"root": str(native_root), "root_pinsela": str(native_root / PINSELA_FILENAME)},
    }


def _publish_native_doc(
    *,
    db: Session | None = None,
    template_key: str,
    template_name: str,
    doc_json: dict[str, Any],
    preview_bytes: bytes | None,
    source: str | None,
    authors: list[str] | None = None,
) -> dict[str, Any]:
    _copy_compat_native_project_if_missing(template_key)
    doc_json = _normalize_doc_image_refs(doc_json)
    schema_json = build_schema_from_native_doc(doc_json)
    figma_mapping_json = build_mapping_from_native_doc(doc_json)
    now_iso = _now_iso()

    root = _project_root(template_key)
    root.mkdir(parents=True, exist_ok=True)
    versions_root = _native_versions_root(template_key)
    version_num = _next_pack_version(versions_root)
    pack_version = f"v{version_num}"
    version_dir = versions_root / pack_version
    if version_dir.exists():
        raise HTTPException(status_code=409, detail=f"pack version already exists: {pack_version}")

    metadata = {
        "template_key": template_key,
        "project_key": template_key,
        "template_name": template_name,
        "project_name": template_name,
        "pack_version": pack_version,
        "uploaded_at": now_iso,
        "source": (source or "api-native").strip()[:128] or "api-native",
        "authors": authors or [],
        "engine_type": NATIVE_PROJECT_ENGINE_TYPE,
    }

    version_dir.mkdir(parents=True, exist_ok=False)
    _atomic_write_text(version_dir / "doc.json", json.dumps(doc_json, ensure_ascii=False, indent=2))
    _atomic_write_text(version_dir / "schema.json", json.dumps(schema_json, ensure_ascii=False, indent=2))
    _atomic_write_text(version_dir / "mapping.json", json.dumps(figma_mapping_json, ensure_ascii=False, indent=2))
    if preview_bytes is not None:
        _atomic_write_bytes(version_dir / "preview.png", preview_bytes)
    _atomic_write_text(version_dir / "pack.meta.json", json.dumps(metadata, ensure_ascii=False, indent=2))
    _write_native_pinsela(
        version_dir,
        doc_json=doc_json,
        schema_json=schema_json,
        mapping_json=figma_mapping_json,
        metadata=metadata,
        preview_bytes=preview_bytes,
    )

    native_root = _native_root(template_key)
    native_root.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(native_root / "doc.json", json.dumps(doc_json, ensure_ascii=False, indent=2))
    _atomic_write_text(native_root / "schema.json", json.dumps(schema_json, ensure_ascii=False, indent=2))
    _atomic_write_text(native_root / "mapping.json", json.dumps(figma_mapping_json, ensure_ascii=False, indent=2))
    if preview_bytes is not None:
        _atomic_write_bytes(native_root / "preview.png", preview_bytes)
    _atomic_write_text(native_root / "pack.meta.json", json.dumps(metadata, ensure_ascii=False, indent=2))
    _write_native_pinsela(
        native_root,
        doc_json=doc_json,
        schema_json=schema_json,
        mapping_json=figma_mapping_json,
        metadata=metadata,
        preview_bytes=preview_bytes,
    )

    tpl = None
    if db is not None:
        tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == template_key).one_or_none()
        if tpl is None:
            tpl = TemplateDefinition(
                key=template_key,
                name=template_name,
                engine_type=NATIVE_PROJECT_ENGINE_TYPE,
                engine_doc_json=doc_json,
                locked=True,
                schema_json=schema_json,
                figma_mapping_json=figma_mapping_json,
            )
            db.add(tpl)
            db.flush()
        else:
            tpl.name = template_name
            tpl.engine_type = NATIVE_PROJECT_ENGINE_TYPE
            tpl.engine_doc_json = doc_json
            tpl.locked = True
            tpl.schema_json = schema_json
            tpl.figma_mapping_json = figma_mapping_json
            db.flush()
        db.commit()

    # Live: tells the open editor that the live version changed. upload-native,
    # publish and restore go through here; without this the agent's edit (which writes
    # through these paths) is not reflected in real time in the editor.
    live_bus.publish_event("doc-changed", key=template_key, updated_at=now_iso)

    return {
        "ok": True,
        "status": "uploaded",
        "template_key": template_key,
        "template_name": template_name,
        "pack_version": pack_version,
        "engine_type": NATIVE_PROJECT_ENGINE_TYPE,
        "template": (
            {"id": str(tpl.id), "key": tpl.key, "name": tpl.name}
            if tpl is not None
            else {"id": None, "key": template_key, "name": template_name}
        ),
        "paths": {
            "root": str(native_root),
            "version": str(version_dir),
            "root_pinsela": str(native_root / PINSELA_FILENAME),
            "version_pinsela": str(version_dir / PINSELA_FILENAME),
        },
    }


def _build_template_schema_from_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    arrays: dict[str, Any] = {}
    content_fields: list[str] = []
    image_fields: list[str] = []
    image_arrays: list[str] = []

    text = manifest.get("text") if isinstance(manifest.get("text"), dict) else {}
    for field_key, raw_rule in text.items():
        field = str(field_key or "").strip()
        rule = raw_rule if isinstance(raw_rule, dict) else {}
        if not field:
            continue
        spec: dict[str, Any] = {
            "type": "string",
            "required": bool(rule.get("required", False)),
            "label": _label_from_key(field),
        }
        max_len = rule.get("max_length")
        if isinstance(max_len, int) and max_len > 0:
            spec["maxLength"] = max_len
        fields[field] = spec
        content_fields.append(field)

    images = manifest.get("images") if isinstance(manifest.get("images"), dict) else {}
    for image_key, raw_rule in images.items():
        field = str(image_key or "").strip()
        rule = raw_rule if isinstance(raw_rule, dict) else {}
        if not field:
            continue

        if isinstance(rule.get("ids"), list):
            ids = [str(x).strip() for x in rule.get("ids") or [] if str(x).strip()]
            if not ids:
                continue
            arrays[field] = {
                "type": "image[]",
                "required": bool(rule.get("required", False)),
                "maxItems": len(ids),
                "label": _label_from_key(field),
                "ui": {"widget": "image"},
            }
            image_arrays.append(field)
            continue

        if str(rule.get("id") or "").strip():
            fields[field] = {
                "type": "string",
                "required": bool(rule.get("required", False)),
                "label": _label_from_key(field),
                "ui": {"widget": "image"},
            }
            image_fields.append(field)

    out: dict[str, Any] = {"version": 2, "fields": fields, "arrays": arrays}
    groups: list[dict[str, Any]] = []
    if content_fields:
        groups.append({"id": "content", "title": "Content", "fields": content_fields, "arrays": []})
    if image_fields or image_arrays:
        groups.append({"id": "images", "title": "Images", "fields": image_fields, "arrays": image_arrays})
    if groups:
        out["ui"] = {"groups": groups}
    return out


def _build_template_mapping_from_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    mapping: dict[str, Any] = {"text_nodes": {}}
    template_kind = str(manifest.get("template_kind") or "").strip().lower()
    if template_kind:
        mapping["template_kind"] = template_kind

    figma_meta = manifest.get("figma") if isinstance(manifest.get("figma"), dict) else {}
    frame_id = str((figma_meta or {}).get("frame_id") or "").strip()
    frame_name = str((figma_meta or {}).get("frame_name") or "").strip()
    if frame_id:
        mapping["source_frame_id"] = frame_id
    if frame_name:
        mapping["source_frame_name"] = frame_name

    text = manifest.get("text") if isinstance(manifest.get("text"), dict) else {}
    text_rules: dict[str, Any] = {}
    for field_key, raw_rule in text.items():
        field = str(field_key or "").strip()
        rule = raw_rule if isinstance(raw_rule, dict) else {}
        node_name = str(rule.get("id") or "").strip()
        if not field or not node_name:
            continue
        mapping["text_nodes"][field] = {"by": "name", "value": node_name}

        fit = rule.get("fit") if isinstance(rule.get("fit"), dict) else {}
        font = rule.get("font") if isinstance(rule.get("font"), dict) else {}
        style = rule.get("style") if isinstance(rule.get("style"), dict) else {}
        text_rule: dict[str, Any] = {}

        def _to_pos_number(v: Any) -> float | None:
            try:
                n = float(v)
            except Exception:
                return None
            if n <= 0:
                return None
            return n

        start_size = _to_pos_number(fit.get("start_size", fit.get("startSize")))
        if start_size is None:
            start_size = _to_pos_number(style.get("font_size", style.get("fontSize")))
        min_size = _to_pos_number(fit.get("min_size", fit.get("minSize")))
        if min_size is None and start_size is not None:
            min_size = max(8.0, round(start_size * 0.65, 2))
        max_lines = _to_pos_number(fit.get("max_lines", fit.get("maxLines")))
        if max_lines is None:
            max_lines = _to_pos_number(style.get("max_lines", style.get("maxLines")))
        min_lines = _to_pos_number(fit.get("min_lines", fit.get("minLines")))
        if start_size is not None:
            text_rule["start_size"] = start_size
        if min_size is not None:
            text_rule["min_size"] = min_size
        if max_lines is not None:
            text_rule["max_lines"] = max_lines
        if min_lines is not None:
            text_rule["min_lines"] = min_lines

        no_truncate = fit.get("no_truncate", fit.get("noTruncate"))
        if isinstance(no_truncate, bool):
            text_rule["no_truncate"] = no_truncate

        family = str(font.get("family") or "").strip()
        if not family:
            style_font = style.get("font") if isinstance(style.get("font"), dict) else {}
            family = str(style_font.get("family") or "").strip()
        style_name = str(font.get("style") or "").strip()
        if not style_name:
            style_font = style.get("font") if isinstance(style.get("font"), dict) else {}
            style_name = str(style_font.get("style") or "").strip()
        if family:
            text_rule["font_family"] = family
        if style_name:
            text_rule["font_style"] = style_name

        if text_rule:
            text_rules[field] = text_rule

    if text_rules:
        mapping["text_rules"] = text_rules

    images = manifest.get("images") if isinstance(manifest.get("images"), dict) else {}
    hero = images.get("hero_image") if isinstance(images.get("hero_image"), dict) else None
    if hero:
        hero_node = str(hero.get("id") or "").strip()
        if hero_node:
            mapping["hero_image"] = {"by": "name", "value": hero_node}

    device = images.get("device_images") if isinstance(images.get("device_images"), dict) else None
    if device:
        ids = [str(x).strip() for x in device.get("ids") or [] if str(x).strip()]
        if ids:
            dev_map: dict[str, Any] = {
                "container": {"by": "name", "value": "DEVICES"},
                "slots": [{"by": "name", "value": x} for x in ids],
                "hide_empty": bool(device.get("hide_empty", True)),
            }
            slot_map = [int(x) for x in (device.get("slot_product_index_map") or []) if str(x).strip().isdigit()]
            if slot_map and len(slot_map) == len(ids):
                dev_map["slot_product_index_map"] = slot_map
            if bool(device.get("per_product_input", False)):
                dev_map["per_product_input"] = True
            mapping["device_images"] = dev_map

    rules = manifest.get("rules") if isinstance(manifest.get("rules"), dict) else {}
    product_frames = rules.get("product_frames") if isinstance(rules.get("product_frames"), dict) else None
    if product_frames:
        ids = [str(x).strip() for x in product_frames.get("ids") or [] if str(x).strip()]
        if ids:
            mapping["product_frames"] = {
                "slots": [{"by": "name", "value": x} for x in ids],
                "hide_empty": bool(product_frames.get("hide_empty", True)),
            }

    return mapping


def _upsert_template_definition(
    db: Session,
    *,
    template_key: str,
    template_name: str,
    manifest: dict[str, Any],
) -> TemplateDefinition:
    schema_json = _build_template_schema_from_manifest(manifest)
    figma_mapping_json = _build_template_mapping_from_manifest(manifest)

    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == template_key).one_or_none()
    if tpl is None:
        tpl = TemplateDefinition(
            key=template_key,
            name=template_name,
            engine_type="svg_manifest_v1",
            engine_doc_json={},
            locked=True,
            schema_json=schema_json,
            figma_mapping_json=figma_mapping_json,
        )
        db.add(tpl)
        db.flush()
        return tpl

    tpl.name = template_name
    tpl.engine_type = "svg_manifest_v1"
    tpl.engine_doc_json = {}
    tpl.locked = True
    tpl.schema_json = schema_json
    tpl.figma_mapping_json = figma_mapping_json
    db.flush()
    return tpl


def _sync_template_definitions_from_disk(db: Session) -> int:
    root = _template_packs_root()
    changed = 0

    existing = {
        t.key: t
        for t in db.query(TemplateDefinition).all()
    }

    for child in root.iterdir():
        if not child.is_dir():
            continue
        key = child.name
        if not _TEMPLATE_KEY_RE.match(key):
            continue

        manifest = _read_json_object(child / "manifest.json")
        if not manifest:
            continue
        if "version" not in manifest:
            manifest["version"] = 1
        try:
            TemplatePackManifestV1.model_validate(manifest)
        except Exception:
            continue

        meta = _read_json_object(child / "pack.meta.json") or {}
        name = _normalize_template_name(str(meta.get("template_name") or ""), fallback_key=key)

        tpl = existing.get(key)
        if tpl is None:
            tpl = TemplateDefinition(
                key=key,
                name=name,
                engine_type="svg_manifest_v1",
                engine_doc_json={},
                locked=True,
                schema_json=_build_template_schema_from_manifest(manifest),
                figma_mapping_json=_build_template_mapping_from_manifest(manifest),
            )
            db.add(tpl)
            existing[key] = tpl
            changed += 1
            continue

        dirty = False
        if not str(tpl.name or "").strip():
            tpl.name = name
            dirty = True
        if not str(tpl.engine_type or "").strip():
            tpl.engine_type = "svg_manifest_v1"
            dirty = True
        if not isinstance(tpl.engine_doc_json, dict):
            tpl.engine_doc_json = {}
            dirty = True
        if not isinstance(tpl.schema_json, dict) or not tpl.schema_json:
            tpl.schema_json = _build_template_schema_from_manifest(manifest)
            dirty = True
        if not isinstance(tpl.figma_mapping_json, dict) or not tpl.figma_mapping_json:
            tpl.figma_mapping_json = _build_template_mapping_from_manifest(manifest)
            dirty = True
        if tpl.locked is not True:
            tpl.locked = True
            dirty = True
        if dirty:
            changed += 1

    if changed:
        db.commit()
    return changed


def _native_project_entries_from_disk() -> list[tuple[str, Path]]:
    entries: dict[str, Path] = {}
    for base in (_project_packs_root(), _compat_project_packs_root()):
        if not base.exists() or not base.is_dir():
            continue
        for child in base.iterdir():
            if not child.is_dir():
                continue
            key = child.name
            if not _TEMPLATE_KEY_RE.match(key):
                continue
            native_dir = child / "native"
            if not native_dir.exists() or not native_dir.is_dir():
                continue
            entries.setdefault(key, native_dir)
    return sorted(entries.items(), key=lambda x: x[0])


def _sync_project_definitions_from_disk(db: Session) -> int:
    changed = 0
    existing = {t.key: t for t in db.query(TemplateDefinition).all()}
    for key, native_dir in _native_project_entries_from_disk():
        doc_json = _read_native_doc_from_dir(native_dir)
        if not isinstance(doc_json, dict) or not doc_json:
            continue

        meta = _read_json_object(native_dir / "pack.meta.json") or {}
        project_name = (
            str(meta.get("project_name") or "").strip()
            or str(meta.get("template_name") or "").strip()
        )
        resolved_name = _normalize_template_name(project_name, fallback_key=key)
        schema_json = _read_json_object(native_dir / "schema.json") or build_schema_from_native_doc(doc_json)
        mapping_json = _read_json_object(native_dir / "mapping.json") or build_mapping_from_native_doc(doc_json)

        tpl = existing.get(key)
        if tpl is None:
            tpl = TemplateDefinition(
                key=key,
                name=resolved_name,
                engine_type=NATIVE_PROJECT_ENGINE_TYPE,
                engine_doc_json=doc_json,
                locked=True,
                schema_json=schema_json,
                figma_mapping_json=mapping_json,
            )
            db.add(tpl)
            existing[key] = tpl
            changed += 1
            continue

        dirty = False
        if str(tpl.engine_type or "").strip() != NATIVE_PROJECT_ENGINE_TYPE:
            tpl.engine_type = NATIVE_PROJECT_ENGINE_TYPE
            dirty = True
        if not str(tpl.name or "").strip():
            tpl.name = resolved_name
            dirty = True
        if not isinstance(tpl.engine_doc_json, dict) or not tpl.engine_doc_json:
            tpl.engine_doc_json = doc_json
            dirty = True
        if not isinstance(tpl.schema_json, dict) or not tpl.schema_json:
            tpl.schema_json = schema_json
            dirty = True
        if not isinstance(tpl.figma_mapping_json, dict) or not tpl.figma_mapping_json:
            tpl.figma_mapping_json = mapping_json
            dirty = True
        if tpl.locked is not True:
            tpl.locked = True
            dirty = True
        if dirty:
            changed += 1

    if changed:
        db.commit()
    return changed


def _is_project_definition(row: TemplateDefinition) -> bool:
    key = str(row.key or "").strip().lower()
    engine_type = str(row.engine_type or "").strip()
    return engine_type == NATIVE_PROJECT_ENGINE_TYPE or key.startswith("proj_")


def list_project_definitions(db: Session, *, lite: bool = False) -> list[TemplateOut] | list[TemplateLiteOut]:
    if _sync_due("projects"):
        _sync_project_definitions_from_disk(db)
    projects_fp = _SYNC_LAST_STORAGE_FP.get("projects") or _bucket_storage_mtime_fingerprint("projects")
    db_marker = _template_definitions_db_marker(db)
    cached = _get_list_cache("projects", lite=lite, db_marker=db_marker, projects_fp=projects_fp)
    if cached is not None:
        return cached
    rows = db.query(TemplateDefinition).order_by(TemplateDefinition.created_at.asc()).all()
    projects = [row for row in rows if _is_project_definition(row)]
    out: list[TemplateOut] | list[TemplateLiteOut]
    if lite:
        out = [_to_template_lite_out(t) for t in projects]
    else:
        out = [_to_template_out(t) for t in projects]
    _set_list_cache("projects", lite=lite, db_marker=db_marker, projects_fp=projects_fp, payload=out)
    return out


def delete_project_definition(project_id: uuid.UUID, db: Session) -> dict[str, Any]:
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.id == project_id).one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Project not found")

    usage_count = db.query(func.count(Artwork.id)).filter(Artwork.template_id == project_id).scalar() or 0
    if usage_count > 0:
        raise HTTPException(status_code=409, detail="Project is in use by existing artworks and cannot be deleted.")

    key = tpl.key
    name = tpl.name
    disk_paths = [_project_root(key), _compat_project_root(key)]
    removed_paths: list[str] = []
    existing_paths: list[str] = []
    for root in disk_paths:
        if not root.exists():
            continue
        existing_paths.append(str(root))
        try:
            shutil.rmtree(root)
            removed_paths.append(str(root))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to remove project files from storage: {e}")

    db.delete(tpl)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Project is in use by existing artworks and cannot be deleted.")

    return {
        "ok": True,
        "status": "deleted",
        "project": {"id": str(project_id), "key": key, "name": name},
        "disk": {
            "paths_found": existing_paths,
            "paths_removed": removed_paths,
        },
    }


@router.post("/upload-pack")
def upload_template_pack(req: TemplatePackUploadRequest, db: Session = Depends(db_session)) -> dict[str, Any]:
    template_key = _normalize_template_key(req.template_key)
    template_name = _normalize_template_name(req.template_name, fallback_key=template_key)

    svg_bytes = _decode_b64("template_svg_b64", req.template_svg_b64, max_bytes=20 * 1024 * 1024)
    preview_bytes: bytes | None = None
    if req.preview_png_b64 and req.preview_png_b64.strip():
        preview_bytes = _decode_b64("preview_png_b64", req.preview_png_b64, max_bytes=20 * 1024 * 1024)

    manifest = dict(req.manifest_json or {})
    if "version" not in manifest:
        manifest["version"] = 1
    try:
        TemplatePackManifestV1.model_validate(manifest)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid manifest_json: {e}")
    _validate_manifest_svg_bindings(svg_bytes, manifest)

    now_iso = _now_iso()
    root = _template_packs_root() / template_key
    root.mkdir(parents=True, exist_ok=True)

    versions_root = root / "versions"
    version_num = _next_pack_version(versions_root)
    pack_version = f"v{version_num}"
    version_dir = versions_root / pack_version

    if version_dir.exists():
        raise HTTPException(status_code=409, detail=f"pack version already exists: {pack_version}")

    metadata = {
        "template_key": template_key,
        "template_name": template_name,
        "pack_version": pack_version,
        "uploaded_at": now_iso,
        "source": (req.source or "api").strip()[:128] or "api",
    }

    version_dir.mkdir(parents=True, exist_ok=False)
    _atomic_write_bytes(version_dir / "template.svg", svg_bytes)
    _atomic_write_text(version_dir / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    if preview_bytes is not None:
        _atomic_write_bytes(version_dir / "preview.png", preview_bytes)
    _atomic_write_text(version_dir / "pack.meta.json", json.dumps(metadata, ensure_ascii=False, indent=2))

    # Keep root files as the currently active pack for the renderer.
    _atomic_write_bytes(root / "template.svg", svg_bytes)
    _atomic_write_text(root / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    if preview_bytes is not None:
        _atomic_write_bytes(root / "preview.png", preview_bytes)
    _atomic_write_text(root / "pack.meta.json", json.dumps(metadata, ensure_ascii=False, indent=2))

    tpl = _upsert_template_definition(
        db,
        template_key=template_key,
        template_name=template_name,
        manifest=manifest,
    )
    db.commit()

    return {
        "ok": True,
        "status": "uploaded",
        "template_key": template_key,
        "template_name": template_name,
        "pack_version": pack_version,
        "template": {
            "id": str(tpl.id),
            "key": tpl.key,
            "name": tpl.name,
        },
        "paths": {
            "root": str(root),
            "version": str(version_dir),
        },
    }


@router.post("/upload-native")
def upload_template_native(req: TemplateNativeUploadRequest, db: Session = Depends(db_session)) -> dict[str, Any]:
    template_key = _normalize_template_key(req.template_key)
    template_name = _normalize_template_name(
        req.template_name or req.project_name,
        fallback_key=template_key,
    )

    try:
        doc_json = validate_native_doc(dict(req.doc_json or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")
    doc_json = _normalize_doc_image_refs(doc_json)

    preview_bytes: bytes | None = None
    if req.preview_png_b64 and req.preview_png_b64.strip():
        preview_bytes = _decode_b64("preview_png_b64", req.preview_png_b64, max_bytes=20 * 1024 * 1024)
    return _publish_native_doc(
        db=db,
        template_key=template_key,
        template_name=template_name,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=req.source or "api-native",
    )


@router.get("/{template_key}/native")
def get_template_native(template_key: str, db: Session = Depends(db_session)) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    _copy_compat_native_project_if_missing(key)
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == key).one_or_none()
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if str(tpl.engine_type or "").strip() != NATIVE_PROJECT_ENGINE_TYPE:
        raise HTTPException(status_code=409, detail="Template is not from the native engine.")
    doc_json = tpl.engine_doc_json if isinstance(tpl.engine_doc_json, dict) and tpl.engine_doc_json else None
    if doc_json is None:
        doc_json = _read_native_doc_from_dir(_native_root_for_read(key))
    if not isinstance(doc_json, dict) or not doc_json:
        raise HTTPException(status_code=404, detail="Native template has no document.")
    updated_at_iso = None
    try:
        if getattr(tpl, "updated_at", None) is not None:
            updated_at_iso = tpl.updated_at.isoformat()
    except Exception:
        updated_at_iso = None
    return {
        "ok": True,
        "template": {
            "id": str(tpl.id),
            "key": tpl.key,
            "name": tpl.name,
            "engine_type": tpl.engine_type,
            "locked": bool(tpl.locked),
        },
        "doc_json": doc_json,
        "updated_at": updated_at_iso,
        "schema_json": tpl.schema_json if isinstance(tpl.schema_json, dict) else {},
        "figma_mapping_json": tpl.figma_mapping_json if isinstance(tpl.figma_mapping_json, dict) else {},
    }


@router.get("/{template_key}/native/versions")
def list_template_native_versions(template_key: str) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    versions_root = _native_versions_root_for_read(key)
    current_meta = _read_json_object(_native_root_for_read(key) / "pack.meta.json") or {}
    current_pack_version = str(current_meta.get("pack_version") or "").strip()

    items: list[dict[str, Any]] = []
    if versions_root.exists() and versions_root.is_dir():
        version_dirs = [x for x in versions_root.iterdir() if x.is_dir() and re.match(r"^v[0-9]+$", x.name)]
        version_dirs.sort(key=lambda p: int(p.name[1:]), reverse=True)
        for d in version_dirs:
            meta = _read_json_object(d / "pack.meta.json") or {}
            doc = _read_native_doc_from_dir(d) or {}
            has_preview = _read_native_preview_from_dir(d) is not None
            items.append(
                {
                    "pack_version": d.name,
                    "is_current": d.name == current_pack_version,
                    "template_name": str(meta.get("template_name") or "").strip() or None,
                    "uploaded_at": meta.get("uploaded_at"),
                    "source": str(meta.get("source") or "").strip() or None,
                    "has_preview": has_preview,
                    "preview_url": (
                        f"/api/projects/{key}/native/versions/{d.name}/preview"
                        if has_preview
                        else None
                    ),
                    "node_count": len(doc.get("nodes") or []) if isinstance(doc.get("nodes"), list) else 0,
                }
            )
    return {
        "ok": True,
        "template_key": key,
        "current_pack_version": current_pack_version or None,
        "versions": items,
    }


@router.get("/{template_key}/native/versions/{pack_version}/preview")
def get_template_native_version_preview(template_key: str, pack_version: str):
    key = _normalize_template_key(template_key)
    version = _parse_pack_version(pack_version)
    version_dir = _native_version_dir_for_read(key, version)
    p = version_dir / "preview.png"
    if p.exists() and p.is_file():
        return FileResponse(str(p), media_type="image/png")
    preview_bytes = _read_native_preview_from_dir(version_dir)
    if preview_bytes is None:
        raise HTTPException(status_code=404, detail=f"Preview not found for {version}.")
    return Response(content=preview_bytes, media_type="image/png")


@router.get("/{template_key}/native/preview")
def get_template_native_latest_preview(template_key: str):
    """Latest visual preview for a project. Canonical-first so the thumbnail
    matches what the editor opens (single source of truth); draft is only a
    fallback, then the newest published version."""
    key = _normalize_template_key(template_key)
    preview = _read_native_preview_from_dir(_native_root_for_read(key))
    if preview is None:
        preview = _read_native_preview_from_dir(_native_draft_root_for_read(key))
    if preview is None:
        versions_root = _native_versions_root_for_read(key)
        if versions_root.exists() and versions_root.is_dir():
            for version_dir in sorted(
                (p for p in versions_root.iterdir() if p.is_dir()),
                key=lambda p: p.name,
                reverse=True,
            ):
                preview = _read_native_preview_from_dir(version_dir)
                if preview is not None:
                    break
    if preview is None:
        raise HTTPException(status_code=404, detail="Preview not found.")
    return Response(
        content=preview,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.post("/{template_key}/native/draft")
def save_template_native_draft(
    template_key: str,
    req: TemplateNativeDraftRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    _copy_compat_native_project_if_missing(key)
    try:
        doc_json = validate_native_doc(dict(req.doc_json or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")
    doc_json = _normalize_doc_image_refs(doc_json)

    preview_bytes: bytes | None = None
    if req.preview_png_b64 and req.preview_png_b64.strip():
        preview_bytes = _decode_b64("preview_png_b64", req.preview_png_b64, max_bytes=20 * 1024 * 1024)

    out, _ = _save_native_draft(
        key=key,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=req.source,
        enqueue_pack=False,
    )
    # Single version: save also writes the live version (DB + disk), not just the draft.
    resolved_db = db if (db is not None and hasattr(db, "query") and hasattr(db, "commit")) else None
    current_sync = _sync_native_current_doc(
        template_key=key,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=req.source or "pinsela-pinsela",
        db=resolved_db,
    )
    out["current_sync"] = {
        "updated_at": current_sync["updated_at"],
        "paths": current_sync["paths"],
    }
    return out


def save_template_native_autosave_delta(
    template_key: str,
    req: TemplateNativeAutosaveDeltaRequest,
    *,
    db: Session | None = None,
) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    _copy_compat_native_project_if_missing(key)
    try:
        doc_json = validate_native_doc(dict(req.doc_json or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")
    doc_json = _normalize_doc_image_refs(doc_json)

    preview_bytes: bytes | None = None
    if req.preview_png_b64 and req.preview_png_b64.strip():
        preview_bytes = _decode_b64("preview_png_b64", req.preview_png_b64, max_bytes=20 * 1024 * 1024)

    out, job_id = _save_native_draft(
        key=key,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=req.source or "autosave-delta",
        enqueue_pack=True,
    )
    out["status"] = "autosave_delta_saved"
    out["delta_id"] = str(req.delta_id or "").strip() or None
    out["queued_job_id"] = job_id
    # Single version: EVERY autosave writes the live version (DB + disk), not just the draft.
    # The sync_current flag was retired (it always syncs) — see spec 2026-06-22.
    current_sync = _sync_native_current_doc(
        template_key=key,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=req.source or "autosave-delta",
        db=db,
    )
    out["current_sync"] = {
        "updated_at": current_sync["updated_at"],
        "paths": current_sync["paths"],
    }
    return out


@router.get("/{template_key}/native/draft")
def get_template_native_draft(template_key: str) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    draft_root = _native_draft_root_for_read(key)
    doc = _read_native_doc_from_dir(draft_root)
    if not isinstance(doc, dict):
        raise HTTPException(status_code=404, detail="Native draft not found.")
    meta = _read_json_object(draft_root / "pack.meta.json") or {}
    return {
        "ok": True,
        "template_key": key,
        "doc_json": doc,
        "meta": meta,
        "has_preview": _read_native_preview_from_dir(draft_root) is not None,
    }


@router.post("/{template_key}/native/simulate")
def simulate_template_native(
    template_key: str,
    req: TemplateNativeSimulateRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    _copy_compat_native_project_if_missing(key)
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == key).one_or_none()
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if str(tpl.engine_type or "").strip() != NATIVE_PROJECT_ENGINE_TYPE:
        raise HTTPException(status_code=409, detail="Template is not from the native engine.")

    if isinstance(req.doc_json, dict) and req.doc_json:
        try:
            doc_json = validate_native_doc(dict(req.doc_json))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")
        doc_json = _normalize_doc_image_refs(doc_json)
    else:
        if not isinstance(tpl.engine_doc_json, dict) or not tpl.engine_doc_json:
            raise HTTPException(status_code=404, detail="Native template has no doc_json.")
        doc_json = tpl.engine_doc_json

    try:
        simulated = simulate_native_layout(doc_json, req.payload or {})
    except NativeRenderEngineError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "ok": True,
        "template_key": key,
        "doc_json": simulated,
    }


@router.post("/{template_key}/native/publish")
def publish_template_native(template_key: str, req: TemplateNativePublishRequest, db: Session = Depends(db_session)) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    _copy_compat_native_project_if_missing(key)
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == key).one_or_none()

    doc_json: dict[str, Any] | None = None
    source_doc = "current"
    if isinstance(req.doc_json, dict) and req.doc_json:
        try:
            doc_json = validate_native_doc(dict(req.doc_json))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")
        source_doc = "request"
    elif bool(req.use_draft):
        draft_doc = _read_native_doc_from_dir(_native_draft_root_for_read(key))
        if isinstance(draft_doc, dict) and draft_doc:
            try:
                doc_json = validate_native_doc(dict(draft_doc))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"invalid draft doc_json: {e}")
            source_doc = "draft"
    if doc_json is None:
        native_doc = _read_native_doc_from_dir(_native_root_for_read(key))
        if isinstance(native_doc, dict) and native_doc:
            try:
                doc_json = validate_native_doc(dict(native_doc))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"invalid current doc_json: {e}")
    if doc_json is None:
        raise HTTPException(status_code=404, detail="No native doc_json available to publish.")

    preview_bytes: bytes | None = None
    if req.preview_png_b64 and req.preview_png_b64.strip():
        preview_bytes = _decode_b64("preview_png_b64", req.preview_png_b64, max_bytes=20 * 1024 * 1024)
    if preview_bytes is None and source_doc == "draft":
        preview_bytes = _read_native_preview_from_dir(_native_draft_root_for_read(key))
    if preview_bytes is None:
        preview_bytes = _read_native_preview_from_dir(_native_root_for_read(key))

    name_fallback = tpl.name if tpl is not None else key
    template_name = _normalize_template_name(req.project_name or req.template_name, fallback_key=name_fallback)
    out = _publish_native_doc(
        db=db,
        template_key=key,
        template_name=template_name,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=req.source or f"native_publish:{source_doc}",
    )
    out["published_from"] = source_doc
    return out


@router.post("/{template_key}/native/restore")
def restore_template_native(template_key: str, req: TemplateNativeRestoreRequest, db: Session = Depends(db_session)) -> dict[str, Any]:
    key = _normalize_template_key(template_key)
    pack_version = _parse_pack_version(req.pack_version)
    version_dir = _native_version_dir_for_read(key, pack_version)
    if not version_dir.exists() or not version_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Native version not found: {pack_version}")
    raw_doc = _read_native_doc_from_dir(version_dir)
    if not isinstance(raw_doc, dict) or not raw_doc:
        raise HTTPException(status_code=404, detail=f"Document missing in version {pack_version}.")
    try:
        doc_json = validate_native_doc(dict(raw_doc))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid doc_json in version {pack_version}: {e}")

    version_meta = _read_json_object(version_dir / "pack.meta.json") or {}
    preview_bytes = _read_native_preview_from_dir(version_dir)
    tpl = (
        db.query(TemplateDefinition).filter(TemplateDefinition.key == key).one_or_none()
        if db is not None
        else None
    )
    name_fallback = tpl.name if tpl is not None else str(version_meta.get("template_name") or key)
    template_name = _normalize_template_name(None, fallback_key=name_fallback)

    # Non-destructive (spec 2026-06-22 §6): snapshots the CURRENT live state into
    # history BEFORE overwriting, so restoring never loses "now".
    current_doc = _read_native_doc_from_dir(_native_root_for_read(key))
    if isinstance(current_doc, dict) and current_doc:
        try:
            current_valid = validate_native_doc(dict(current_doc))
        except Exception:
            current_valid = None
        if current_valid is not None:
            _publish_native_doc(
                db=db,
                template_key=key,
                template_name=template_name,
                doc_json=current_valid,
                preview_bytes=_read_native_preview_from_dir(_native_root_for_read(key)),
                source="pre-restore-snapshot",
            )

    out = _publish_native_doc(
        db=db,
        template_key=key,
        template_name=template_name,
        doc_json=doc_json,
        preview_bytes=preview_bytes,
        source=f"native_restore:{pack_version}",
    )
    out["restored_from"] = pack_version
    return out


@router.get("")
def list_templates(
    db: Session = Depends(db_session),
    lite: bool = Query(default=False),
) -> list[TemplateOut] | list[TemplateLiteOut]:
    if _sync_due("templates"):
        _sync_template_definitions_from_disk(db)
    if _sync_due("projects"):
        _sync_project_definitions_from_disk(db)
    templates_fp = _SYNC_LAST_STORAGE_FP.get("templates") or _bucket_storage_mtime_fingerprint("templates")
    projects_fp = _SYNC_LAST_STORAGE_FP.get("projects") or _bucket_storage_mtime_fingerprint("projects")
    db_marker = _template_definitions_db_marker(db)
    cached = _get_list_cache(
        "templates",
        lite=lite,
        db_marker=db_marker,
        templates_fp=templates_fp,
        projects_fp=projects_fp,
    )
    if cached is not None:
        return cached
    templates = db.query(TemplateDefinition).order_by(TemplateDefinition.created_at.asc()).all()
    out: list[TemplateOut] | list[TemplateLiteOut]
    if lite:
        out = [_to_template_lite_out(t) for t in templates]
    else:
        out = [_to_template_out(t) for t in templates]
    _set_list_cache(
        "templates",
        lite=lite,
        db_marker=db_marker,
        templates_fp=templates_fp,
        projects_fp=projects_fp,
        payload=out,
    )
    return out


@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: uuid.UUID, req: TemplateUpdate, db: Session = Depends(db_session)) -> TemplateOut:
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.id == template_id).one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if bool(tpl.locked):
        raise HTTPException(status_code=409, detail="Template is locked for direct editing. Use the Pinsela editor.")

    if req.name is not None:
        tpl.name = req.name
    if req.schema_json is not None:
        tpl.schema_json = req.schema_json
    if req.figma_mapping_json is not None:
        tpl.figma_mapping_json = req.figma_mapping_json

    db.commit()
    return TemplateOut(
        id=tpl.id,
        key=tpl.key,
        name=tpl.name,
        engine_type=tpl.engine_type or "svg_manifest_v1",
        locked=bool(tpl.locked),
        schema_json=tpl.schema_json,
        figma_mapping_json=tpl.figma_mapping_json,
    )


@router.delete("/{template_id}")
def delete_template(template_id: uuid.UUID, db: Session = Depends(db_session)) -> dict[str, Any]:
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.id == template_id).one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if _is_project_definition(tpl):
        raise HTTPException(
            status_code=409,
            detail="This record is a project. Delete it via the projects route (/api/projects/{id}).",
        )

    usage_count = db.query(func.count(Artwork.id)).filter(Artwork.template_id == template_id).scalar() or 0
    if usage_count > 0:
        raise HTTPException(status_code=409, detail="Template is in use by existing artworks and cannot be deleted.")

    key = tpl.key
    name = tpl.name

    root = _template_packs_root() / key
    disk_existed = root.exists()
    if root.exists():
        try:
            shutil.rmtree(root)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to remove template files from storage: {e}")

    db.delete(tpl)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Template is in use by existing artworks and cannot be deleted.")

    return {
        "ok": True,
        "status": "deleted",
        "template": {"id": str(template_id), "key": key, "name": name},
        "disk": {"existed": disk_existed, "removed": (not disk_existed) or (not root.exists()), "path": str(root)},
    }
