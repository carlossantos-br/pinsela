from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


_BRL_PRICE_RE = re.compile(r"^\s*(R\$\s*)?\d{1,3}(\.\d{3})*(,\d{2})\s*$|^\s*(R\$\s*)?\d+(\.\d{2})\s*$")


@dataclass(frozen=True)
class ValidationReport:
    ok: bool
    violations: list[dict[str, Any]]
    auto_fixes: list[dict[str, Any]]


def validate_and_normalize_content(template_schema: dict, content: dict) -> tuple[dict, ValidationReport]:
    """
    Validates and normalizes content based on a lightweight template schema.

    Returns a (possibly) modified content dict plus a validation report describing
    violations and any auto-fixes (for example, truncation).
    """

    schema_fields: dict = (template_schema or {}).get("fields") or {}
    schema_arrays: dict = (template_schema or {}).get("arrays") or {}

    normalized = dict(content or {})
    violations: list[dict[str, Any]] = []
    auto_fixes: list[dict[str, Any]] = []

    def truncate(field: str, value: str, max_len: int) -> str:
        if len(value) <= max_len:
            return value
        new_value = value[:max_len].rstrip()
        auto_fixes.append({"field": field, "action": "truncate", "before_len": len(value), "after_len": len(new_value)})
        return new_value

    for field, spec in schema_fields.items():
        required = bool(spec.get("required", False))
        typ = spec.get("type", "string")
        max_len = spec.get("maxLength")
        fmt = spec.get("format")

        if field not in normalized:
            if required:
                violations.append({"field": field, "rule": "required", "message": "Required field is missing"})
            continue

        value = normalized.get(field)
        if value is None:
            if required:
                violations.append({"field": field, "rule": "required", "message": "Required field is null"})
            continue

        if typ == "string":
            if not isinstance(value, str):
                violations.append({"field": field, "rule": "type", "message": f"Expected string, got {type(value).__name__}"})
                continue
            if required and not value.strip():
                violations.append({"field": field, "rule": "required", "message": "Required field is empty"})
                continue
            if isinstance(max_len, int):
                normalized[field] = truncate(field, value, max_len)
            if fmt == "brl_price":
                if normalized[field].strip() and not _BRL_PRICE_RE.match(normalized[field]):
                    violations.append({"field": field, "rule": "format", "message": "Price does not match the expected format (BRL)"})

    for field, spec in schema_arrays.items():
        required = bool(spec.get("required", False))
        max_items = spec.get("maxItems")
        typ = spec.get("type")

        if field not in normalized:
            if required:
                violations.append({"field": field, "rule": "required", "message": "Required field is missing"})
            continue

        value = normalized.get(field)
        if value is None:
            continue
        if typ == "image[]" or isinstance(value, list):
            if not isinstance(value, list):
                violations.append({"field": field, "rule": "type", "message": f"Expected list, got {type(value).__name__}"})
                continue
            if isinstance(max_items, int) and len(value) > max_items:
                normalized[field] = value[:max_items]
                auto_fixes.append({"field": field, "action": "truncate_items", "before": len(value), "after": len(normalized[field])})

    ok = len(violations) == 0
    return normalized, ValidationReport(ok=ok, violations=violations, auto_fixes=auto_fixes)
