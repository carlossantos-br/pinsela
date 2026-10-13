from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from pinsela.auth import require_admin
from pinsela.db import db_session
from pinsela.models import TemplateDefinition
from pinsela.services.jobs import enqueue_create_artworks


router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(require_admin)])


class CreateArtworksBulkRequest(BaseModel):
    template_key: str = Field(default="master", min_length=1, max_length=64)
    rows: list[dict[str, Any]] = Field(default_factory=list, min_length=1, max_length=500)
    output_kind: str = Field(default="jpg")
    render_local: bool = False
    stop_on_error: bool = False


def _is_blank_cell(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return not v.strip()
    return False


def _as_array_cell(v: Any) -> list[str]:
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if _is_blank_cell(v):
        return []
    # CSV cell support for arrays: "a|b|c"
    return [x.strip() for x in str(v).split("|") if x.strip()]


def _validate_row_against_schema(row: dict[str, Any], schema_json: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(row, dict):
        return [{"field": "*", "code": "invalid_row", "message": "Invalid row (object expected)."}]
    if not isinstance(schema_json, dict):
        return []

    fields = schema_json.get("fields") if isinstance(schema_json.get("fields"), dict) else {}
    arrays = schema_json.get("arrays") if isinstance(schema_json.get("arrays"), dict) else {}
    errors: list[dict[str, Any]] = []

    for field, raw_spec in fields.items():
        if not isinstance(raw_spec, dict):
            continue
        required = bool(raw_spec.get("required", False))
        value = row.get(field)
        if _is_blank_cell(value):
            if required:
                errors.append({"field": field, "code": "required", "message": "Required field is missing."})
            continue
        max_length = raw_spec.get("maxLength")
        if isinstance(max_length, int) and max_length > 0 and len(str(value)) > max_length:
            errors.append(
                {
                    "field": field,
                    "code": "max_length",
                    "message": f"Value exceeds maxLength={max_length}.",
                }
            )

    for field, raw_spec in arrays.items():
        if not isinstance(raw_spec, dict):
            continue
        required = bool(raw_spec.get("required", False))
        values = _as_array_cell(row.get(field))
        if not values:
            if required:
                errors.append({"field": field, "code": "required", "message": "Required array is missing."})
            continue
        max_items = raw_spec.get("maxItems")
        if isinstance(max_items, int) and max_items > 0 and len(values) > max_items:
            errors.append(
                {
                    "field": field,
                    "code": "max_items",
                    "message": f"Array excede maxItems={max_items}.",
                }
            )

    return errors


@router.post("/create-artworks-bulk")
def create_artworks_bulk(req: CreateArtworksBulkRequest, db: Session = Depends(db_session)) -> dict[str, Any]:
    tpl = db.query(TemplateDefinition).filter(TemplateDefinition.key == req.template_key).one_or_none()
    schema_json = tpl.schema_json if tpl is not None and isinstance(tpl.schema_json, dict) else {}
    has_schema_validation = bool(
        isinstance(schema_json, dict)
        and (isinstance(schema_json.get("fields"), dict) or isinstance(schema_json.get("arrays"), dict))
    )

    created = 0
    failed = 0
    items: list[dict[str, Any]] = []
    for idx, row in enumerate(req.rows):
        content = row if isinstance(row, dict) else {}
        cell_errors = _validate_row_against_schema(content, schema_json) if has_schema_validation else []
        if cell_errors:
            failed += 1
            items.append(
                {
                    "index": idx,
                    "ok": False,
                    "job_id": None,
                    "error": "validation_error",
                    "cell_errors": cell_errors,
                }
            )
            if req.stop_on_error:
                break
            continue
        try:
            with db.begin_nested():
                job = enqueue_create_artworks(
                    db,
                    count=1,
                    template_key=req.template_key,
                    content=content,
                    render_local=req.render_local,
                    output_kind=req.output_kind,
                )
                db.flush()
            created += 1
            items.append({"index": idx, "ok": True, "job_id": str(job.id), "error": None, "cell_errors": []})
        except Exception as e:
            failed += 1
            items.append({"index": idx, "ok": False, "job_id": None, "error": str(e), "cell_errors": []})
            if req.stop_on_error:
                break
    db.commit()
    return {
        "ok": True,
        "created": created,
        "failed": failed,
        "items": items,
        "validation": {"schema_checked": has_schema_validation},
    }
