from __future__ import annotations

import os

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers.jobs import _validate_row_against_schema


def test_validate_row_against_schema_required_and_max_length() -> None:
    schema = {
        "version": 2,
        "fields": {
            "title1": {"type": "string", "required": True, "maxLength": 10},
            "body1": {"type": "string", "required": False, "maxLength": 50},
        },
        "arrays": {},
    }

    missing_required = _validate_row_against_schema({"body1": "ok"}, schema)
    assert any(e["field"] == "title1" and e["code"] == "required" for e in missing_required)

    too_long = _validate_row_against_schema({"title1": "01234567890"}, schema)
    assert any(e["field"] == "title1" and e["code"] == "max_length" for e in too_long)

    ok = _validate_row_against_schema({"title1": "ok", "body1": "x"}, schema)
    assert ok == []


def test_validate_row_against_schema_array_max_items() -> None:
    schema = {
        "version": 2,
        "fields": {},
        "arrays": {
            "device_images": {"type": "image[]", "required": True, "maxItems": 2},
        },
    }

    missing = _validate_row_against_schema({}, schema)
    assert any(e["field"] == "device_images" and e["code"] == "required" for e in missing)

    too_many = _validate_row_against_schema({"device_images": "a|b|c"}, schema)
    assert any(e["field"] == "device_images" and e["code"] == "max_items" for e in too_many)
