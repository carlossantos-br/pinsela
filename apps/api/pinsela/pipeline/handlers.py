from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from pinsela.audit import log_event
from pinsela.config import get_settings
from pinsela.content_rules import validate_and_normalize_content
from pinsela.models import (
    Artwork,
    ArtworkVersion,
    ExportAsset,
    InputAsset,
    Job,
    JobStep,
    StepStatus,
    TemplateDefinition,
)
from pinsela.services.render_engine_native import render_native_template
from pinsela.services.templates import ensure_default_template, get_template_by_key


def _now() -> datetime:
    return datetime.now(timezone.utc)


_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _is_native_template(tpl: TemplateDefinition | None) -> bool:
    return bool(tpl and str(tpl.engine_type or "").strip() == "pinsela_native_v1" and isinstance(tpl.engine_doc_json, dict))


def _asset_role_from_tags(tags: list[str] | None) -> str | None:
    for t in tags or []:
        s = str(t or "").strip().lower()
        if s == "role:hero":
            return "hero"
        if s == "role:device":
            return "device"
    return None


def _asset_id_from_ref(ref: Any) -> uuid.UUID | None:
    if isinstance(ref, str):
        s = ref.strip()
        if _UUID_RE.match(s):
            try:
                return uuid.UUID(s)
            except Exception:
                return None
    if isinstance(ref, dict):
        raw = ref.get("asset_id")
        if isinstance(raw, str):
            return _asset_id_from_ref(raw)
    return None


def _validate_content_asset_roles(db: Session, content: dict[str, Any]) -> None:
    hero_asset_id = _asset_id_from_ref(content.get("hero_image"))
    if hero_asset_id:
        hero_asset = db.query(InputAsset).filter(InputAsset.id == hero_asset_id).one_or_none()
        if not hero_asset:
            raise ValueError(f"HERO asset_id not found: {hero_asset_id}")
        role = _asset_role_from_tags(hero_asset.tags if isinstance(hero_asset.tags, list) else [])
        if role and role != "hero":
            raise ValueError(f"Invalid HERO: asset {hero_asset_id} is marked as role:{role}")

    devices = content.get("device_images")
    if not isinstance(devices, list):
        return
    for idx, ref in enumerate(devices):
        aid = _asset_id_from_ref(ref)
        if not aid:
            continue
        asset = db.query(InputAsset).filter(InputAsset.id == aid).one_or_none()
        if not asset:
            raise ValueError(f"DEVICE_{idx+1} asset_id not found: {aid}")
        role = _asset_role_from_tags(asset.tags if isinstance(asset.tags, list) else [])
        if role and role != "device":
            raise ValueError(f"Invalid DEVICE_{idx+1}: asset {aid} is marked as role:{role}")


def _safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _export_path(*, artwork_id: uuid.UUID, version_number: int, kind: str) -> Path:
    settings = get_settings()
    root = Path(settings.server_data_root) / "exports" / str(artwork_id) / f"v{version_number:04d}"
    _safe_mkdir(root)
    ext = kind.lower()
    if ext == "jpeg":
        ext = "jpg"
    return root / f"export.{ext}"


def handle_create_artworks(db: Session, job: Job, step: JobStep) -> dict[str, Any]:
    payload = job.payload or {}
    count = int(payload.get("count") or 1)
    count = max(1, min(200, count))
    template_key = str(payload.get("template_key") or "master")
    output_kind = str(payload.get("output_kind") or "jpg").strip().lower()
    if output_kind == "jpeg":
        output_kind = "jpg"
    if output_kind not in {"png", "jpg"}:
        output_kind = "jpg"
    base_content = payload.get("content") or {}

    tpl = get_template_by_key(db, key=template_key)
    if tpl is None:
        tpl = ensure_default_template(db)
    job.payload = {**(job.payload or {}), "template_engine": str(tpl.engine_type or "svg_manifest_v1")}

    created: list[dict[str, str]] = []
    log_event(db, event="create_artworks.start", job_id=job.id, details={"count": count, "template_key": tpl.key})

    for i in range(count):
        content = dict(base_content)
        if "title" in content and isinstance(content["title"], str) and count > 1:
            content["title"] = f"{content['title']} #{i+1}"
        elif "title" not in content:
            content["title"] = f"Artwork {i+1}"
        if "identity_name" in content and isinstance(content["identity_name"], str) and count > 1:
            content["identity_name"] = f"{content['identity_name']} #{i+1}"
        elif "identity_name" not in content or not str(content.get("identity_name") or "").strip():
            content["identity_name"] = str(content.get("title") or f"Artwork {i+1}")
        if "price" not in content:
            content["price"] = "R$ 0,00"
        if not str(content.get("installments") or "").strip() and str(content.get("installments_count") or "").strip() and str(content.get("installments_value") or "").strip():
            content["installments"] = f"{content['installments_count']}x of {content['installments_value']}"
        if "device_images" not in content:
            content["device_images"] = []

        _validate_content_asset_roles(db, content)

        normalized, report = validate_and_normalize_content(tpl.schema_json, content)
        if not report.ok:
            raise ValueError(f"Validation failed for item {i+1}: {report.violations}")

        display_name = str(normalized.get("identity_name") or normalized.get("title") or "")
        category = normalized.get("category")
        tags = normalized.get("tags")
        artwork = Artwork(
            template_id=tpl.id,
            display_name=display_name,
            category=str(category).strip() if isinstance(category, str) and category.strip() else None,
            tags=[str(x) for x in tags if isinstance(x, (str, int, float, bool)) and str(x).strip()] if isinstance(tags, list) else [],
        )
        db.add(artwork)
        db.flush()

        version = ArtworkVersion(
            artwork_id=artwork.id,
            version_number=1,
            content=normalized,
        )
        db.add(version)
        db.flush()

        created.append({"artwork_id": str(artwork.id), "version_id": str(version.id)})

        db.add(
            JobStep(
                job_id=job.id,
                name="VERSION_EXPORT",
                status=StepStatus.queued.value,
                input={"version_id": str(version.id), "kind": output_kind},
                run_after=_now(),
            )
        )

    job.result = {**(job.result or {}), "created": created}
    log_event(db, event="create_artworks.created", job_id=job.id, details={"items": created})
    return {"created_count": len(created)}


def handle_create_version_record(db: Session, job: Job, step: JobStep) -> dict[str, Any]:
    payload = job.payload or {}
    artwork_id = uuid.UUID(str(payload["artwork_id"]))
    output_kind = str(payload.get("output_kind") or "jpg").strip().lower()
    if output_kind == "jpeg":
        output_kind = "jpg"
    if output_kind not in {"png", "jpg"}:
        output_kind = "jpg"
    patch = payload.get("content_patch") or {}

    artwork = db.query(Artwork).filter(Artwork.id == artwork_id).one()
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.id == artwork.template_id).one()
    job.payload = {**(job.payload or {}), "template_engine": str(tpl.engine_type or "svg_manifest_v1")}

    latest = (
        db.query(ArtworkVersion)
        .filter(ArtworkVersion.artwork_id == artwork_id)
        .order_by(ArtworkVersion.version_number.desc())
        .limit(1)
        .one_or_none()
    )
    base = dict(latest.content if latest else {})
    new_content = {**base, **patch}
    if not str(new_content.get("identity_name") or "").strip():
        if str(new_content.get("title") or "").strip():
            new_content["identity_name"] = str(new_content.get("title") or "")
    if not str(new_content.get("installments") or "").strip() and str(new_content.get("installments_count") or "").strip() and str(new_content.get("installments_value") or "").strip():
        new_content["installments"] = f"{new_content['installments_count']}x of {new_content['installments_value']}"

    _validate_content_asset_roles(db, new_content)

    normalized, report = validate_and_normalize_content(tpl.schema_json, new_content)
    if not report.ok:
        raise ValueError(f"Validation failed: {report.violations}")

    if "identity_name" in patch and isinstance(normalized.get("identity_name"), str) and normalized.get("identity_name").strip():
        artwork.display_name = normalized["identity_name"].strip()
    elif "title" in patch and isinstance(normalized.get("title"), str) and normalized.get("title").strip():
        artwork.display_name = normalized["title"].strip()

    if "category" in patch:
        cat = normalized.get("category")
        artwork.category = cat.strip() if isinstance(cat, str) and cat.strip() else None

    if "tags" in patch:
        tags = normalized.get("tags")
        artwork.tags = [str(x) for x in tags if isinstance(x, (str, int, float, bool)) and str(x).strip()] if isinstance(tags, list) else []

    next_version_number = (latest.version_number if latest else 0) + 1
    version = ArtworkVersion(
        artwork_id=artwork_id,
        version_number=next_version_number,
        content=normalized,
    )
    db.add(version)
    db.flush()

    db.add(
        JobStep(
            job_id=job.id,
            name="VERSION_EXPORT",
            status=StepStatus.queued.value,
            input={"version_id": str(version.id), "kind": output_kind},
            run_after=_now(),
        )
    )

    log_event(
        db,
        event="create_version.created",
        job_id=job.id,
        artwork_id=artwork_id,
        artwork_version_id=version.id,
        details={"version_number": next_version_number},
    )
    return {"version_id": str(version.id), "version_number": next_version_number}


def handle_version_export(db: Session, job: Job, step: JobStep) -> dict[str, Any]:
    version_id = uuid.UUID(step.input["version_id"])
    kind = str(step.input.get("kind") or "png")

    version = db.query(ArtworkVersion).filter(ArtworkVersion.id == version_id).one()
    artwork = db.query(Artwork).filter(Artwork.id == version.artwork_id).one()
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.id == artwork.template_id).one()

    is_native = _is_native_template(tpl)

    if is_native:
        rendered = render_native_template(tpl.engine_doc_json or {}, version.content or {}, db=db)
        k = kind.lower()
        if k == "jpeg":
            k = "jpg"
        if k not in rendered:
            raise ValueError(f"Unsupported kind for native renderer: {kind} (supported: png, jpg)")
        data, meta = rendered[k]
        dest = _export_path(artwork_id=artwork.id, version_number=version.version_number, kind=k)
        _safe_mkdir(dest.parent)
        dest.write_bytes(data)

        asset = ExportAsset(
            artwork_version_id=version.id,
            kind=k.lower(),
            server_path=str(dest),
            sha256=meta["sha256"],
            bytes=meta["bytes"],
            width=meta["width"],
            height=meta["height"],
            official_path=None,
            official_url=None,
            is_official_copy=False,
        )
        db.add(asset)
        db.flush()
        log_event(
            db,
            event="export.created_native",
            job_id=job.id,
            artwork_id=artwork.id,
            artwork_version_id=version.id,
            details={
                "kind": k,
                "server_path": str(dest),
                "sha256": meta["sha256"],
                "bytes": meta["bytes"],
                "template_key": tpl.key,
                "engine_type": "pinsela_native_v1",
            },
        )
        return {"asset_id": str(asset.id), "server_path": str(dest), **meta, "mode": "native-render"}

    from pinsela.services.render_engine import apply_payload_to_svg, load_template_pack, render_svg_to_png_jpg

    pack = load_template_pack(tpl.key)
    svg = pack.svg_path.read_bytes()
    expected_w = int((pack.manifest.get("size") or {}).get("width") or 0)
    expected_h = int((pack.manifest.get("size") or {}).get("height") or 0)
    expected_size = (expected_w, expected_h) if expected_w and expected_h else None

    svg2 = apply_payload_to_svg(svg, version.content or {}, pack.manifest, db=db)
    rendered = render_svg_to_png_jpg(svg2, expected_size=expected_size)

    k = kind.lower()
    if k == "jpeg":
        k = "jpg"
    if k not in rendered:
        raise ValueError(f"Unsupported kind for local renderer: {kind} (supported: png, jpg)")

    data, meta = rendered[k]
    dest = _export_path(artwork_id=artwork.id, version_number=version.version_number, kind=k)
    _safe_mkdir(dest.parent)
    dest.write_bytes(data)

    asset = ExportAsset(
        artwork_version_id=version.id,
        kind=k.lower(),
        server_path=str(dest),
        sha256=meta["sha256"],
        bytes=meta["bytes"],
        width=meta["width"],
        height=meta["height"],
        official_path=None,
        official_url=None,
        is_official_copy=False,
    )
    db.add(asset)
    db.flush()

    log_event(
        db,
        event="export.created_local",
        job_id=job.id,
        artwork_id=artwork.id,
        artwork_version_id=version.id,
        details={"kind": k, "server_path": str(dest), "sha256": meta["sha256"], "bytes": meta["bytes"], "template_key": tpl.key},
    )
    return {"asset_id": str(asset.id), "server_path": str(dest), **meta, "mode": "local-render"}


HANDLERS: dict[str, Any] = {
    "CREATE_ARTWORKS": handle_create_artworks,
    "CREATE_VERSION_RECORD": handle_create_version_record,
    "VERSION_EXPORT": handle_version_export,
}
