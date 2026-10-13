"""Task 7 — pure decision logic of the single-version migration."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

from migrate_single_version import decide_migration  # noqa: E402

A = {"nodes": [{"id": "t", "text": "A"}]}
B = {"nodes": [{"id": "t", "text": "B"}]}


def test_no_draft_is_noop() -> None:
    assert decide_migration(None, 0.0, A, 100.0) == "noop"


def test_only_draft_promotes() -> None:
    assert decide_migration(A, 100.0, None, 0.0) == "promote-draft"


def test_equal_docs_noop() -> None:
    assert decide_migration(A, 200.0, dict(A), 100.0) == "noop"


def test_newer_draft_promotes() -> None:
    assert decide_migration(B, 200.0, A, 100.0) == "promote-draft"


def test_newer_canonical_noop() -> None:
    assert decide_migration(B, 100.0, A, 200.0) == "noop"
