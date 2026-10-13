from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from pinsela.auth import require_admin
from pinsela.db import db_session
from pinsela.schemas import TemplateLiteOut, TemplateOut
from . import templates


router = APIRouter(prefix="/api/projects", tags=["projects"], dependencies=[Depends(require_admin)])


def _with_project_alias(payload: dict[str, Any], project_key: str) -> dict[str, Any]:
    out = dict(payload or {})
    out.setdefault("project_key", project_key)
    if "template_key" in out:
        out.setdefault("project_key", out.get("template_key"))
    if "template_name" in out:
        out.setdefault("project_name", out.get("template_name"))
    if isinstance(out.get("template"), dict):
        out.setdefault("project", out.get("template"))
    return out


@router.get("")
def list_projects(
    db: Session = Depends(db_session),
    lite: bool = Query(default=False),
) -> list[TemplateOut] | list[TemplateLiteOut]:
    return templates.list_project_definitions(db, lite=lite)


@router.delete("/{project_id}")
def delete_project(project_id: uuid.UUID, db: Session = Depends(db_session)) -> dict[str, Any]:
    return templates.delete_project_definition(project_id, db)


@router.post("/upload-native")
def upload_project_native(
    req: templates.TemplateNativeUploadRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    out = templates.upload_template_native(req, db)
    return _with_project_alias(out, req.template_key)


@router.get("/{project_key}/native")
def get_project_native(project_key: str, db: Session = Depends(db_session)) -> dict[str, Any]:
    out = templates.get_template_native(project_key, db)
    return _with_project_alias(out, project_key)


@router.get("/{project_key}/native/versions")
def list_project_native_versions(project_key: str) -> dict[str, Any]:
    out = templates.list_template_native_versions(project_key)
    return _with_project_alias(out, project_key)


@router.get("/{project_key}/native/versions/{pack_version}/preview")
def get_project_native_version_preview(project_key: str, pack_version: str):
    return templates.get_template_native_version_preview(project_key, pack_version)


@router.post("/{project_key}/native/draft")
def save_project_native_draft(
    project_key: str,
    req: templates.TemplateNativeDraftRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    resolved_db = db if hasattr(db, "query") and hasattr(db, "commit") else None
    out = templates.save_template_native_draft(project_key, req, db=resolved_db)
    return _with_project_alias(out, project_key)


@router.post("/{project_key}/autosave-delta")
def save_project_autosave_delta(
    project_key: str,
    req: templates.TemplateNativeAutosaveDeltaRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    resolved_db = db if hasattr(db, "query") and hasattr(db, "commit") else None
    out = templates.save_template_native_autosave_delta(project_key, req, db=resolved_db)
    return _with_project_alias(out, project_key)


@router.get("/{project_key}/native/draft")
def get_project_native_draft(project_key: str) -> dict[str, Any]:
    out = templates.get_template_native_draft(project_key)
    return _with_project_alias(out, project_key)


@router.post("/{project_key}/native/simulate")
def simulate_project_native(
    project_key: str,
    req: templates.TemplateNativeSimulateRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    out = templates.simulate_template_native(project_key, req, db)
    return _with_project_alias(out, project_key)


@router.post("/{project_key}/native/publish")
def publish_project_native(
    project_key: str,
    req: templates.TemplateNativePublishRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    out = templates.publish_template_native(project_key, req, db)
    return _with_project_alias(out, project_key)


@router.post("/{project_key}/native/restore")
def restore_project_native(
    project_key: str,
    req: templates.TemplateNativeRestoreRequest,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    out = templates.restore_template_native(project_key, req, db)
    return _with_project_alias(out, project_key)
