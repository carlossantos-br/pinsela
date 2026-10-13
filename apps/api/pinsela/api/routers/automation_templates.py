from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from pinsela.auth import AdminPrincipal, require_admin
from pinsela.config import get_settings
from pinsela.services.template_native import validate_native_doc


router = APIRouter(
    prefix="/api/automation-templates",
    tags=["automation_templates"],
    dependencies=[Depends(require_admin)],
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _storage_root() -> Path:
    settings = get_settings()
    root = Path(settings.server_data_root) / "automation_templates"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _owner_key(username: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(username or "").strip().lower())
    return normalized or "user"


def _owner_store_path(username: str) -> Path:
    return _storage_root() / f"{_owner_key(username)}.json"


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".tmp-{path.name}-{uuid.uuid4().hex}"
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def _read_owner_store(username: str) -> dict[str, Any]:
    path = _owner_store_path(username)
    if not path.exists():
        return {"version": 1, "items": []}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "items": []}
    if not isinstance(raw, dict):
        return {"version": 1, "items": []}
    items = raw.get("items")
    if not isinstance(items, list):
        items = []
    return {"version": 1, "items": items}


def _write_owner_store(username: str, payload: dict[str, Any]) -> None:
    path = _owner_store_path(username)
    data = {
        "version": 1,
        "items": payload.get("items") if isinstance(payload.get("items"), list) else [],
    }
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def _summary_payload(raw: dict[str, Any]) -> dict[str, Any]:
    bindings = raw.get("bindings") if isinstance(raw.get("bindings"), list) else []
    return {
        "id": str(raw.get("id") or "").strip(),
        "name": str(raw.get("name") or "").strip(),
        "project_key": str(raw.get("project_key") or "").strip() or None,
        "source_page_name": str(raw.get("source_page_name") or "").strip() or None,
        "binding_count": len(bindings),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
    }


def _detail_payload(raw: dict[str, Any]) -> dict[str, Any]:
    doc_json = raw.get("doc_json") if isinstance(raw.get("doc_json"), dict) else None
    if doc_json is None:
        raise HTTPException(status_code=500, detail="Corrupted automation template (doc_json missing).")
    bindings = raw.get("bindings") if isinstance(raw.get("bindings"), list) else []
    return {
        "id": str(raw.get("id") or "").strip(),
        "name": str(raw.get("name") or "").strip(),
        "project_key": str(raw.get("project_key") or "").strip() or None,
        "source_page_name": str(raw.get("source_page_name") or "").strip() or None,
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "bindings": bindings,
        "doc_json": doc_json,
    }


class AutomationBindingModel(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    layer_name: str = Field(min_length=1, max_length=256)
    kind: Literal["text", "image", "frame"]


class CreateAutomationTemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    project_key: str | None = Field(default=None, max_length=64)
    source_page_name: str | None = Field(default=None, max_length=128)
    doc_json: dict[str, Any]
    bindings: list[AutomationBindingModel] = Field(default_factory=list, min_length=1, max_length=512)


class UpdateAutomationTemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    project_key: str | None = Field(default=None, max_length=64)
    source_page_name: str | None = Field(default=None, max_length=128)
    doc_json: dict[str, Any]
    bindings: list[AutomationBindingModel] = Field(default_factory=list, min_length=1, max_length=512)



@router.get("")
def list_automation_templates(principal: AdminPrincipal = Depends(require_admin)) -> dict[str, Any]:
    store = _read_owner_store(principal.username)
    items = []
    for raw in store["items"]:
        if not isinstance(raw, dict):
            continue
        template_id = str(raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()
        if not template_id or not name:
            continue
        items.append(_summary_payload(raw))
    items.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
    return {"ok": True, "items": items}


@router.get("/{template_id}")
def get_automation_template(template_id: str, principal: AdminPrincipal = Depends(require_admin)) -> dict[str, Any]:
    target_id = str(template_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="Invalid template_id.")
    store = _read_owner_store(principal.username)
    for raw in store["items"]:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("id") or "").strip() != target_id:
            continue
        return {"ok": True, "template": _detail_payload(raw)}
    raise HTTPException(status_code=404, detail="Automation template not found.")


@router.post("")
def create_automation_template(
    req: CreateAutomationTemplateRequest,
    principal: AdminPrincipal = Depends(require_admin),
) -> dict[str, Any]:
    name = str(req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Invalid name.")
    try:
        doc_json = validate_native_doc(dict(req.doc_json or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")

    bindings = [
        {
            "id": str(binding.id).strip(),
            "layer_name": str(binding.layer_name).strip(),
            "kind": str(binding.kind).strip(),
        }
        for binding in req.bindings
        if str(binding.id).strip() and str(binding.layer_name).strip()
    ]
    if not bindings:
        raise HTTPException(status_code=400, detail="Invalid bindings.")

    now = _now_iso()
    store = _read_owner_store(principal.username)
    item = {
        "id": str(uuid.uuid4()),
        "name": name[:128],
        "project_key": str(req.project_key or "").strip().lower() or None,
        "source_page_name": str(req.source_page_name or "").strip() or None,
        "created_at": now,
        "updated_at": now,
        "doc_json": doc_json,
        "bindings": bindings,
    }
    store["items"].append(item)
    _write_owner_store(principal.username, store)
    return {
        "ok": True,
        "template": {
            "id": item["id"],
            "name": item["name"],
            "project_key": item["project_key"],
            "source_page_name": item["source_page_name"],
            "binding_count": len(bindings),
            "created_at": item["created_at"],
            "updated_at": item["updated_at"],
        },
    }


@router.put("/{template_id}")
def update_automation_template(
    template_id: str,
    req: UpdateAutomationTemplateRequest,
    principal: AdminPrincipal = Depends(require_admin),
) -> dict[str, Any]:
    target_id = str(template_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="Invalid template_id.")

    name = str(req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Invalid name.")
    try:
        doc_json = validate_native_doc(dict(req.doc_json or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid doc_json: {e}")

    bindings = [
        {
            "id": str(binding.id).strip(),
            "layer_name": str(binding.layer_name).strip(),
            "kind": str(binding.kind).strip(),
        }
        for binding in req.bindings
        if str(binding.id).strip() and str(binding.layer_name).strip()
    ]
    if not bindings:
        raise HTTPException(status_code=400, detail="Invalid bindings.")

    store = _read_owner_store(principal.username)
    found: dict[str, Any] | None = None
    now = _now_iso()
    for raw in store["items"]:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("id") or "").strip() != target_id:
            continue
        raw["name"] = name[:128]
        raw["project_key"] = str(req.project_key or "").strip().lower() or None
        raw["source_page_name"] = str(req.source_page_name or "").strip() or None
        raw["doc_json"] = doc_json
        raw["bindings"] = bindings
        raw["updated_at"] = now
        found = raw
        break

    if found is None:
        raise HTTPException(status_code=404, detail="Automation template not found.")

    _write_owner_store(principal.username, store)
    return {"ok": True, "template": _summary_payload(found)}


@router.delete("/{template_id}")
def delete_automation_template(template_id: str, principal: AdminPrincipal = Depends(require_admin)) -> dict[str, Any]:
    target_id = str(template_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="Invalid template_id.")
    store = _read_owner_store(principal.username)
    next_items = [
        raw
        for raw in store["items"]
        if isinstance(raw, dict) and str(raw.get("id") or "").strip() != target_id
    ]
    if len(next_items) == len(store["items"]):
        raise HTTPException(status_code=404, detail="Automation template not found.")
    store["items"] = next_items
    _write_owner_store(principal.username, store)
    return {"ok": True, "deleted_id": target_id}
