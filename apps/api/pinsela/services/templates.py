from __future__ import annotations

from sqlalchemy.orm import Session

from pinsela.defaults import DEFAULT_TEMPLATE_KEY, default_template_mapping, default_template_schema
from pinsela.models import TemplateDefinition


def ensure_default_template(db: Session) -> TemplateDefinition:
    existing = db.query(TemplateDefinition).filter(TemplateDefinition.key == DEFAULT_TEMPLATE_KEY).one_or_none()
    if existing:
        # Safe forward-compat: if this instance still has the original v1 default schema,
        # upgrade it to the current default so the UI can render the new simple form.
        try:
            sch = existing.schema_json or {}
            fields = sch.get("fields") or {}
            arrays = sch.get("arrays") or {}
            looks_like_v1 = (
                (sch.get("version") in (None, 1))
                and (not sch.get("ui"))
                and set(fields.keys()) == {"title", "subtitle", "price", "installments"}
                and set(arrays.keys()) == {"device_images"}
            )
            if looks_like_v1:
                existing.schema_json = default_template_schema()
                db.add(existing)
                db.flush()
        except Exception:
            pass
        try:
            dirty = False
            if not str(existing.engine_type or "").strip():
                existing.engine_type = "svg_manifest_v1"
                dirty = True
            if not isinstance(existing.engine_doc_json, dict):
                existing.engine_doc_json = {}
                dirty = True
            if dirty:
                db.add(existing)
                db.flush()
        except Exception:
            pass
        return existing

    tpl = TemplateDefinition(
        key=DEFAULT_TEMPLATE_KEY,
        name="Template Master (Default)",
        engine_type="svg_manifest_v1",
        engine_doc_json={},
        locked=False,
        schema_json=default_template_schema(),
        figma_mapping_json=default_template_mapping(),
    )
    db.add(tpl)
    db.flush()
    return tpl


def get_template_by_key(db: Session, *, key: str) -> TemplateDefinition | None:
    return db.query(TemplateDefinition).filter(TemplateDefinition.key == key).one_or_none()
