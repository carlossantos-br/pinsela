from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com,other@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import projects, templates


def test_save_project_autosave_delta_keeps_project_alias(monkeypatch: Any) -> None:
    def _fake_save(
        project_key: str,
        req: templates.TemplateNativeAutosaveDeltaRequest,
        *,
        db: Any = None,
    ) -> dict[str, Any]:
        assert project_key == "proj_abc"
        assert isinstance(req.doc_json, dict)
        assert db is None
        return {
            "ok": True,
            "template_key": "proj_abc",
            "template_name": "Project ABC",
            "status": "autosave_delta_saved",
            "packaging": "queued",
            "queued_job_id": "job-123",
        }

    monkeypatch.setattr(templates, "save_template_native_autosave_delta", _fake_save)
    out = projects.save_project_autosave_delta(
        "proj_abc",
        templates.TemplateNativeAutosaveDeltaRequest(doc_json={"version": 1}),
    )
    assert out["ok"] is True
    assert out["project_key"] == "proj_abc"
    assert out["project_name"] == "Project ABC"
    assert out["queued_job_id"] == "job-123"
