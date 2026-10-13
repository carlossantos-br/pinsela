from __future__ import annotations

import json
import os
import uuid
import zipfile
from pathlib import Path
from typing import Any


PINSELA_FILENAME = "project.pinsela"
PINSELA_FORMAT_VERSION = 1


def _json_to_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_pinsela_package(
    path: Path,
    *,
    doc_json: dict[str, Any],
    schema_json: dict[str, Any] | None = None,
    mapping_json: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    preview_png: bytes | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".tmp-{path.name}-{uuid.uuid4().hex}"
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "meta.json",
                _json_to_bytes(
                    {
                        "format": "pinsela_project",
                        "format_version": PINSELA_FORMAT_VERSION,
                        **(metadata or {}),
                    }
                ),
            )
            zf.writestr("document.json", _json_to_bytes(doc_json))
            if isinstance(schema_json, dict) and schema_json:
                zf.writestr("schema.json", _json_to_bytes(schema_json))
            if isinstance(mapping_json, dict) and mapping_json:
                zf.writestr("mapping.json", _json_to_bytes(mapping_json))
            if preview_png is not None:
                zf.writestr("preview.png", preview_png)
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def read_pinsela_package(path: Path) -> dict[str, Any] | None:
    if not path.exists() or not path.is_file():
        return None
    try:
        with zipfile.ZipFile(path, "r") as zf:
            names = set(zf.namelist())
            document_name = "document.json" if "document.json" in names else ("doc.json" if "doc.json" in names else None)
            if not document_name:
                return None

            raw_doc = json.loads(zf.read(document_name).decode("utf-8"))
            if not isinstance(raw_doc, dict):
                return None

            meta: dict[str, Any] = {}
            if "meta.json" in names:
                try:
                    raw_meta = json.loads(zf.read("meta.json").decode("utf-8"))
                    if isinstance(raw_meta, dict):
                        meta = raw_meta
                except Exception:
                    meta = {}

            schema: dict[str, Any] | None = None
            if "schema.json" in names:
                try:
                    raw_schema = json.loads(zf.read("schema.json").decode("utf-8"))
                    if isinstance(raw_schema, dict):
                        schema = raw_schema
                except Exception:
                    schema = None

            mapping: dict[str, Any] | None = None
            if "mapping.json" in names:
                try:
                    raw_mapping = json.loads(zf.read("mapping.json").decode("utf-8"))
                    if isinstance(raw_mapping, dict):
                        mapping = raw_mapping
                except Exception:
                    mapping = None

            preview_png: bytes | None = None
            if "preview.png" in names:
                try:
                    preview_png = zf.read("preview.png")
                except Exception:
                    preview_png = None

            return {
                "doc_json": raw_doc,
                "meta": meta,
                "schema_json": schema,
                "mapping_json": mapping,
                "preview_png": preview_png,
            }
    except Exception:
        return None

