"""Task 5 — live bus: pub/sub, presence and doc-changed on autosave."""
from __future__ import annotations

import json
import os
import queue
from pathlib import Path

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.services import live_bus  # noqa: E402
from pinsela.api.routers import templates, live_events  # noqa: E402
from tests.test_native_single_source import _doc  # noqa: E402


def _drain(q) -> list[dict]:
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except queue.Empty:
            break
    return out


def test_bus_pubsub_delivers_to_subscriber() -> None:
    q = live_bus.subscribe()
    try:
        live_bus.publish_event("foo", key="k1", n=1)
        assert q.get_nowait() == {"type": "foo", "key": "k1", "n": 1}
    finally:
        live_bus.unsubscribe(q)


def test_presence_set_publish_and_clear() -> None:
    q = live_bus.subscribe()
    try:
        live_bus.set_presence("artA", "working", "editing the title")
        assert live_bus.current_presence().get("artA", {}).get("state") == "working"
        ev = q.get_nowait()
        assert ev["type"] == "presence" and ev["key"] == "artA" and ev["state"] == "working"
        live_bus.set_presence("artA", "idle")
        assert "artA" not in live_bus.current_presence()
    finally:
        live_bus.unsubscribe(q)


def test_post_presence_endpoint_function() -> None:
    out = live_events.post_presence(live_events.PresenceIn(key="zz", state="working"))
    assert out["ok"] is True
    assert live_bus.current_presence().get("zz", {}).get("state") == "working"
    live_bus.set_presence("zz", "idle")  # cleanup


def test_autosave_emits_doc_changed(monkeypatch, tmp_path: Path) -> None:
    projects_root = tmp_path / "projects"
    projects_root.mkdir(parents=True)
    monkeypatch.setattr(templates, "_project_packs_root", lambda: projects_root)
    monkeypatch.setattr(templates, "enqueue_draft_pack_job", lambda **kw: "job")

    key = "proj_live"
    native = projects_root / key / "native"
    native.mkdir(parents=True)
    (native / "doc.json").write_text(json.dumps(_doc("X")), encoding="utf-8")
    (native / "pack.meta.json").write_text(json.dumps({"template_name": "x"}), encoding="utf-8")

    q = live_bus.subscribe()
    try:
        templates.save_template_native_autosave_delta(
            key, templates.TemplateNativeAutosaveDeltaRequest(doc_json=_doc("Y")), db=None
        )
        types = [(e["type"], e.get("key")) for e in _drain(q)]
        assert ("doc-changed", key) in types
    finally:
        live_bus.unsubscribe(q)
