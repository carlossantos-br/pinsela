from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import templates


def test_sync_due_uses_storage_mtime_fingerprint(monkeypatch: Any) -> None:
    bucket = "projects"
    times = {"now": 0.0}
    fps = {"value": "fp-1"}

    monkeypatch.setitem(templates._SYNC_LAST_RUN, bucket, 0.0)
    monkeypatch.setitem(templates._SYNC_LAST_STORAGE_FP, bucket, None)
    monkeypatch.setattr(templates.time, "monotonic", lambda: times["now"])
    monkeypatch.setattr(templates, "_bucket_storage_mtime_fingerprint", lambda _bucket: fps["value"])

    # First call always syncs and stores fingerprint.
    assert templates._sync_due(bucket) is True
    assert templates._SYNC_LAST_STORAGE_FP[bucket] == "fp-1"

    # Within throttle window, no sync even if unchanged.
    times["now"] = 0.5
    assert templates._sync_due(bucket) is False

    # After throttle window, unchanged fingerprint skips disk sync.
    times["now"] = templates._SYNC_INTERVAL_SECONDS + 0.1
    assert templates._sync_due(bucket) is False

    # Fingerprint change forces sync once throttle window elapsed again.
    fps["value"] = "fp-2"
    times["now"] += templates._SYNC_INTERVAL_SECONDS + 0.1
    assert templates._sync_due(bucket) is True
    assert templates._SYNC_LAST_STORAGE_FP[bucket] == "fp-2"

