"""Task 2 — restore is non-destructive: the current live state goes into history
BEFORE the old version is loaded, so nothing is lost when going back."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com,other@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.api.routers import templates  # noqa: E402
from tests.test_native_single_source import _doc, _title_of  # noqa: E402


def _version_titles(native_root: Path) -> list[str]:
    titles: list[str] = []
    vroot = native_root / "versions"
    if not vroot.exists():
        return titles
    for d in vroot.iterdir():
        doc_path = d / "doc.json"
        if doc_path.exists():
            titles.append(_title_of(json.loads(doc_path.read_text(encoding="utf-8"))))
    return titles


def test_restore_snapshots_current_before_overwrite(monkeypatch, tmp_path: Path) -> None:
    projects_root = tmp_path / "projects"
    projects_root.mkdir(parents=True)
    monkeypatch.setattr(templates, "_project_packs_root", lambda: projects_root)

    key = "proj_restore"
    native_root = projects_root / key / "native"
    native_root.mkdir(parents=True)
    # Current live state = B (recent edits not yet snapshotted).
    (native_root / "doc.json").write_text(json.dumps(_doc("B")), encoding="utf-8")
    (native_root / "pack.meta.json").write_text(json.dumps({"template_name": "Proj Restore"}), encoding="utf-8")
    # Old version v1 = A.
    v1 = native_root / "versions" / "v1"
    v1.mkdir(parents=True)
    (v1 / "doc.json").write_text(json.dumps(_doc("A")), encoding="utf-8")
    (v1 / "pack.meta.json").write_text(json.dumps({"pack_version": "v1", "template_name": "Proj Restore"}), encoding="utf-8")

    templates.restore_template_native(
        key, templates.TemplateNativeRestoreRequest(pack_version="v1"), db=None
    )

    # The live version is now A.
    live = json.loads((native_root / "doc.json").read_text(encoding="utf-8"))
    assert _title_of(live) == "A", "restore did not apply the chosen version"
    # And the previous state (B) was preserved in history.
    assert "B" in _version_titles(native_root), "restore destroyed the current state (B) — it was not snapshotted"
