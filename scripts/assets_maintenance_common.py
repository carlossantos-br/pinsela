#!/usr/bin/env python3
from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator


REPO_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPO_ROOT / "apps" / "api"
NATIVE_PROJECT_ENGINE_TYPE = "pinsela_native_v1"
PINSELA_FILENAME = "project.pinsela"
_BACKFILL_TAGS = ["migration", "dataurl-backfill"]

DATA_URL_IMAGE_RE = re.compile(
    r"^data:(?P<mime>image/[a-zA-Z0-9.+-]+)(?:;charset=[^;,]+)?;base64,(?P<data>[A-Za-z0-9+/=\s]+)$",
    flags=re.IGNORECASE,
)
ASSET_ID_RE = re.compile(r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")
MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}


@dataclass
class RuntimeHandles:
    get_settings: Any
    SessionLocal: Any
    InputAsset: Any
    TemplateDefinition: Any
    read_pinsela_package: Any
    write_pinsela_package: Any


@dataclass(frozen=True)
class DiskDocLocation:
    kind: str  # "json" | "package"
    path: Path


@dataclass
class LoadedDiskDoc:
    location: DiskDocLocation
    doc_json: dict[str, Any]
    package_payload: dict[str, Any] | None = None


@dataclass
class DataUrlImage:
    mime: str
    ext: str
    data: bytes
    sha256: str
    width: int
    height: int


@dataclass
class AssetResolution:
    status: str
    can_patch: bool
    asset_id: str | None = None
    image_src: str | None = None
    reason: str | None = None


@dataclass
class BackfillStats:
    docs_scanned_db: int = 0
    docs_scanned_disk: int = 0
    docs_changed_db: int = 0
    docs_changed_disk: int = 0
    image_nodes_seen: int = 0
    dataurl_nodes_seen: int = 0
    patchable_nodes: int = 0
    patched_nodes: int = 0
    assets_created: int = 0
    assets_reused_db: int = 0
    assets_reused_memory: int = 0
    assets_would_create: int = 0
    skipped_unsupported_mime: int = 0
    skipped_invalid_dataurl: int = 0
    skipped_invalid_image: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class OrphanGcStats:
    refs_from_db_docs: int = 0
    refs_from_disk_docs: int = 0
    db_docs_scanned: int = 0
    disk_docs_scanned: int = 0
    assets_total: int = 0
    assets_considered: int = 0
    assets_referenced: int = 0
    assets_too_new: int = 0
    assets_skipped_tag: int = 0
    candidates: int = 0
    deleted_rows: int = 0
    deleted_files: int = 0
    missing_files: int = 0
    skipped_outside_assets_root: int = 0
    errors: list[str] = field(default_factory=list)


def ensure_api_import_path() -> None:
    if str(API_ROOT) not in sys.path:
        sys.path.insert(0, str(API_ROOT))


def bootstrap_runtime() -> RuntimeHandles:
    ensure_api_import_path()
    from pinsela.config import get_settings
    from pinsela.db import SessionLocal
    from pinsela.models import InputAsset, TemplateDefinition
    from pinsela.services.pinsela_package import read_pinsela_package, write_pinsela_package

    return RuntimeHandles(
        get_settings=get_settings,
        SessionLocal=SessionLocal,
        InputAsset=InputAsset,
        TemplateDefinition=TemplateDefinition,
        read_pinsela_package=read_pinsela_package,
        write_pinsela_package=write_pinsela_package,
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


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_bytes(path, json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))


def _dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    out: list[Path] = []
    for path in paths:
        try:
            key = str(path.resolve())
        except Exception:
            key = str(path)
        if key in seen:
            continue
        seen.add(key)
        out.append(path)
    return out


def iter_native_doc_locations(server_data_root: Path) -> Iterator[DiskDocLocation]:
    roots = _dedupe_paths([
        server_data_root / "projects",
        server_data_root / "templates",
    ])
    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for pattern, kind in ((PINSELA_FILENAME, "package"), ("doc.json", "json")):
            for path in sorted(root.rglob(pattern)):
                if not path.is_file():
                    continue
                # Restrict to native project docs to avoid touching non-native template packs.
                if "native" not in path.parts:
                    continue
                yield DiskDocLocation(kind=kind, path=path)


def load_disk_doc(location: DiskDocLocation, runtime: RuntimeHandles) -> LoadedDiskDoc | None:
    if location.kind == "package":
        payload = runtime.read_pinsela_package(location.path)
        if not payload or not isinstance(payload.get("doc_json"), dict):
            return None
        return LoadedDiskDoc(
            location=location,
            doc_json=copy.deepcopy(payload["doc_json"]),
            package_payload=payload,
        )

    try:
        raw = json.loads(location.path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    return LoadedDiskDoc(location=location, doc_json=raw)


def save_disk_doc(loaded: LoadedDiskDoc, runtime: RuntimeHandles) -> None:
    if loaded.location.kind == "package":
        payload = loaded.package_payload or {}
        runtime.write_pinsela_package(
            loaded.location.path,
            doc_json=loaded.doc_json,
            schema_json=payload.get("schema_json") if isinstance(payload.get("schema_json"), dict) else None,
            mapping_json=payload.get("mapping_json") if isinstance(payload.get("mapping_json"), dict) else None,
            metadata=payload.get("meta") if isinstance(payload.get("meta"), dict) else None,
            preview_png=payload.get("preview_png") if isinstance(payload.get("preview_png"), (bytes, bytearray)) else None,
        )
        return
    atomic_write_json(loaded.location.path, loaded.doc_json)


def parse_data_url_image(raw: str) -> DataUrlImage | str:
    value = str(raw or "").strip()
    m = DATA_URL_IMAGE_RE.match(value)
    if not m:
        return "invalid_dataurl"

    mime = str(m.group("mime") or "").strip().lower()
    ext = MIME_TO_EXT.get(mime)
    if not ext:
        return "unsupported_mime"

    payload = re.sub(r"\s+", "", str(m.group("data") or ""))
    try:
        data = base64.b64decode(payload.encode("ascii"), validate=True)
    except Exception:
        return "invalid_dataurl"
    if not data:
        return "invalid_dataurl"

    try:
        from io import BytesIO
        from PIL import Image

        img = Image.open(BytesIO(data))
        img.load()
        width, height = img.size
    except Exception:
        return "invalid_image"

    return DataUrlImage(
        mime=mime,
        ext=ext,
        data=data,
        sha256=hashlib.sha256(data).hexdigest(),
        width=max(1, int(width)),
        height=max(1, int(height)),
    )


def extract_asset_uuid(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except Exception:
        pass
    m = ASSET_ID_RE.search(raw)
    if not m:
        return None
    try:
        return str(uuid.UUID(m.group(1)))
    except Exception:
        return None


def asset_api_path(asset_id: str) -> str:
    return f"/api/assets/{asset_id}"


def mutate_doc_image_nodes(doc: Any, mutator: Callable[[dict[str, Any]], bool]) -> tuple[int, int]:
    image_nodes_seen = 0
    changed_nodes = 0

    def walk(value: Any) -> None:
        nonlocal image_nodes_seen, changed_nodes
        if isinstance(value, dict):
            if str(value.get("kind") or "").strip().lower() == "image":
                image_nodes_seen += 1
                if mutator(value):
                    changed_nodes += 1
            for child in value.values():
                walk(child)
            return
        if isinstance(value, list):
            for item in value:
                walk(item)

    walk(doc)
    return image_nodes_seen, changed_nodes


def collect_asset_refs_from_doc(doc: Any) -> set[str]:
    refs: set[str] = set()

    def collect(node: dict[str, Any]) -> bool:
        asset_id = extract_asset_uuid(node.get("image_asset_id"))
        if asset_id:
            refs.add(asset_id)
        src_id = extract_asset_uuid(node.get("image_src"))
        if src_id:
            refs.add(src_id)
        return False

    mutate_doc_image_nodes(doc, collect)
    return refs


def path_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def iter_db_native_docs(session: Any, runtime: RuntimeHandles) -> Iterator[Any]:
    TemplateDefinition = runtime.TemplateDefinition
    query = session.query(TemplateDefinition).filter(TemplateDefinition.engine_type == NATIVE_PROJECT_ENGINE_TYPE)
    for row in query.order_by(TemplateDefinition.created_at.asc()).all():
        if isinstance(getattr(row, "engine_doc_json", None), dict) and row.engine_doc_json:
            yield row


class AssetRegistry:
    def __init__(self, *, session: Any, runtime: RuntimeHandles, asset_root: Path, apply: bool, stats: BackfillStats) -> None:
        self._session = session
        self._runtime = runtime
        self._asset_root = asset_root
        self._apply = bool(apply)
        self._stats = stats
        self._cache: dict[tuple[str, int, str], AssetResolution] = {}
        self._asset_root.mkdir(parents=True, exist_ok=True)

    def resolve_data_url(self, data_url: str, *, preferred_name: str | None = None) -> AssetResolution:
        parsed = parse_data_url_image(data_url)
        if isinstance(parsed, str):
            if parsed == "unsupported_mime":
                self._stats.skipped_unsupported_mime += 1
            elif parsed == "invalid_image":
                self._stats.skipped_invalid_image += 1
            else:
                self._stats.skipped_invalid_dataurl += 1
            return AssetResolution(status=parsed, can_patch=False, reason=parsed)

        key = (parsed.sha256, len(parsed.data), parsed.mime)
        cached = self._cache.get(key)
        if cached is not None:
            self._stats.assets_reused_memory += 1
            return AssetResolution(
                status="reused_memory",
                can_patch=True,
                asset_id=cached.asset_id,
                image_src=cached.image_src,
            )

        InputAsset = self._runtime.InputAsset
        existing_rows = (
            self._session.query(InputAsset)
            .filter(InputAsset.kind == "image")
            .filter(InputAsset.sha256 == parsed.sha256)
            .filter(InputAsset.bytes == len(parsed.data))
            .order_by(InputAsset.created_at.asc())
            .all()
        )
        for row in existing_rows:
            row_path = Path(str(row.server_path or ""))
            if not row_path.exists() or not row_path.is_file():
                continue
            asset_id = str(row.id)
            resolved = AssetResolution(
                status="reused_db",
                can_patch=True,
                asset_id=asset_id,
                image_src=asset_api_path(asset_id),
            )
            self._cache[key] = resolved
            self._stats.assets_reused_db += 1
            return resolved

        if not self._apply:
            self._stats.assets_would_create += 1
            return AssetResolution(status="would_create", can_patch=True)

        asset_uuid = uuid.uuid4()
        dest = self._asset_root / f"{asset_uuid}.{parsed.ext}"
        _atomic_write_bytes(dest, parsed.data)

        safe_name = str(preferred_name or "").strip() or None
        row = InputAsset(
            id=asset_uuid,
            kind="image",
            name=(safe_name[:256] if safe_name else None),
            tags=list(_BACKFILL_TAGS),
            mime_type=parsed.mime,
            ext=parsed.ext,
            bytes=len(parsed.data),
            width=parsed.width,
            height=parsed.height,
            sha256=parsed.sha256,
            server_path=str(dest),
        )
        self._session.add(row)
        self._session.commit()

        asset_id = str(row.id)
        resolved = AssetResolution(
            status="created",
            can_patch=True,
            asset_id=asset_id,
            image_src=asset_api_path(asset_id),
        )
        self._cache[key] = resolved
        self._stats.assets_created += 1
        return resolved


def format_backfill_summary(stats: BackfillStats) -> dict[str, Any]:
    return {
        "docs_scanned": {
            "db": stats.docs_scanned_db,
            "disk": stats.docs_scanned_disk,
        },
        "docs_changed": {
            "db": stats.docs_changed_db,
            "disk": stats.docs_changed_disk,
        },
        "image_nodes_seen": stats.image_nodes_seen,
        "dataurl_nodes_seen": stats.dataurl_nodes_seen,
        "patchable_nodes": stats.patchable_nodes,
        "patched_nodes": stats.patched_nodes,
        "assets": {
            "created": stats.assets_created,
            "reused_db": stats.assets_reused_db,
            "reused_memory": stats.assets_reused_memory,
            "would_create": stats.assets_would_create,
        },
        "skipped": {
            "unsupported_mime": stats.skipped_unsupported_mime,
            "invalid_dataurl": stats.skipped_invalid_dataurl,
            "invalid_image": stats.skipped_invalid_image,
        },
        "errors": stats.errors,
    }


def format_orphan_gc_summary(stats: OrphanGcStats) -> dict[str, Any]:
    return {
        "docs_scanned": {
            "db": stats.db_docs_scanned,
            "disk": stats.disk_docs_scanned,
        },
        "refs_collected": {
            "db_docs": stats.refs_from_db_docs,
            "disk_docs": stats.refs_from_disk_docs,
        },
        "assets": {
            "total": stats.assets_total,
            "considered": stats.assets_considered,
            "referenced": stats.assets_referenced,
            "too_new": stats.assets_too_new,
            "skipped_tag": stats.assets_skipped_tag,
            "candidates": stats.candidates,
            "deleted_rows": stats.deleted_rows,
            "deleted_files": stats.deleted_files,
            "missing_files": stats.missing_files,
            "skipped_outside_assets_root": stats.skipped_outside_assets_root,
        },
        "errors": stats.errors,
    }
