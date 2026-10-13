"""Task 4 — per-session history: trigger logic + authors + retention."""
from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.services import session_snapshots as ss  # noqa: E402


def test_no_snapshot_within_rapid_session() -> None:
    ss._sessions.clear()
    ss.note_edit("k", now=1000.0, author="user")
    assert ss.should_snapshot("k", now=1001.0) is False
    ss.note_edit("k", now=1001.0, author="user")
    assert ss.should_snapshot("k", now=1010.0) is False


def test_snapshot_after_idle_gap() -> None:
    ss._sessions.clear()
    ss.note_edit("k", now=1000.0, author="user")
    assert ss.should_snapshot("k", now=1000.0 + ss.IDLE_SECONDS + 1) is True


def test_snapshot_on_long_session_cap() -> None:
    ss._sessions.clear()
    ss.note_edit("k", now=0.0, author="user")
    t = 0.0
    while t < ss.MAX_SECONDS:
        t += 60.0  # edits every 60s (< IDLE), but the window keeps growing
        ss.note_edit("k", now=t, author="user")
    assert ss.should_snapshot("k", now=ss.MAX_SECONDS + 1) is True


def test_session_authors_aggregates_and_resets() -> None:
    ss._sessions.clear()
    ss.note_edit("k", 0.0, "user")
    ss.note_edit("k", 10.0, "agent")
    assert ss.session_authors("k") == ["agent", "user"]
    ss.reset_after_snapshot("k", 100.0)
    assert ss.session_authors("k") == []
    assert ss.should_snapshot("k", 101.0) is False


def test_classify_author() -> None:
    assert ss.classify_author("autosave-delta") == "user"
    assert ss.classify_author("composer") == "agent"
    assert ss.classify_author("") == "agent"


def test_gc_keeps_recent_or_within_days(tmp_path: Path) -> None:
    vroot = tmp_path / "versions"
    vroot.mkdir()
    now = 1_000_000_000.0
    old = now - (ss.KEEP_DAYS + 5) * 86400.0  # well beyond the days window
    for i in range(1, 61):  # v1..v60, all old
        d = vroot / f"v{i}"
        d.mkdir()
        (d / "doc.json").write_text("{}", encoding="utf-8")
        os.utime(d, (old, old))

    removed = ss.gc_versions(vroot, now, keep_last_n=50, keep_days=ss.KEEP_DAYS)
    # 60 dirs, keeps the 50 most recent (v11..v60) → removes v1..v10.
    assert sorted(removed, key=lambda n: int(n[1:])) == [f"v{i}" for i in range(1, 11)]
    remaining = sorted(int(d.name[1:]) for d in vroot.iterdir() if d.is_dir())
    assert remaining == list(range(11, 61))


def test_gc_keeps_old_when_within_last_n(tmp_path: Path) -> None:
    vroot = tmp_path / "versions"
    vroot.mkdir()
    now = 1_000_000_000.0
    old = now - (ss.KEEP_DAYS + 5) * 86400.0
    for i in range(1, 6):  # only 5 old versions
        d = vroot / f"v{i}"
        d.mkdir()
        os.utime(d, (old, old))
    removed = ss.gc_versions(vroot, now, keep_last_n=50, keep_days=ss.KEEP_DAYS)
    assert removed == []  # within keep_last_n → nothing disappears, even if old
