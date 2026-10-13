"""Per-session history (spec 2026-06-22 §6).

The live version is saved on every action; the HISTORY, however, gets 1 point per
"editing session" — a burst of changes becomes a single snapshot, so the restore
list stays clean (not a thousand points).

In-memory state per artwork: session window (start, last edit, authors).
Pure logic with an injectable `now` (testable without a real clock).

Snapshot trigger (from the PREVIOUS state, taken before applying the new edit):
  - previous session closed: idle for >= IDLE_SECONDS since the last edit; OR
  - long-session cap: >= MAX_SECONDS elapsed since the window start.

Retention (gc): keeps the last KEEP_LAST_N points OR those up to KEEP_DAYS days old —
whichever is LARGER (only removes what is beyond N AND older than the days).
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

IDLE_SECONDS = 180.0
MAX_SECONDS = 1200.0
KEEP_LAST_N = 50
KEEP_DAYS = 60

# key -> {"window_start": float, "last_edit": float, "authors": set[str]}
_sessions: dict[str, dict] = {}

_USER_MARKERS = ("autosave", "editor", "user")


def classify_author(source: str) -> str:
    """user only for editor edits (autosave); everything else = agent. Same as the watcher."""
    s = (source or "").strip().lower()
    return "user" if any(m in s for m in _USER_MARKERS) else "agent"


def note_edit(key: str, now: float, author: str) -> None:
    st = _sessions.get(key)
    if st is None:
        _sessions[key] = {"window_start": now, "last_edit": now, "authors": {author}}
    else:
        st["last_edit"] = now
        st["authors"].add(author)


def should_snapshot(key: str, now: float) -> bool:
    st = _sessions.get(key)
    if st is None:
        return False
    if (now - st["last_edit"]) >= IDLE_SECONDS:
        return True
    if (now - st["window_start"]) >= MAX_SECONDS:
        return True
    return False


def session_authors(key: str) -> list[str]:
    st = _sessions.get(key)
    return sorted(st["authors"]) if st and st["authors"] else []


def reset_after_snapshot(key: str, now: float) -> None:
    """Opens a new session window starting at `now` (call after snapshotting)."""
    _sessions[key] = {"window_start": now, "last_edit": now, "authors": set()}


def gc_versions(
    versions_root: Path,
    now: float,
    *,
    keep_last_n: int = KEEP_LAST_N,
    keep_days: int = KEEP_DAYS,
) -> list[str]:
    """Removes versions beyond keep_last_n AND older than keep_days. Returns removed names."""
    if not versions_root.exists() or not versions_root.is_dir():
        return []
    dirs = [d for d in versions_root.iterdir() if d.is_dir() and re.match(r"^v[0-9]+$", d.name)]
    dirs.sort(key=lambda p: int(p.name[1:]))  # oldest first
    if keep_last_n > 0 and len(dirs) > keep_last_n:
        candidates = dirs[:-keep_last_n]
    else:
        candidates = []
    cutoff = now - keep_days * 86400.0
    removed: list[str] = []
    for d in candidates:
        try:
            old_enough = d.stat().st_mtime < cutoff
        except OSError:
            continue
        if old_enough:
            shutil.rmtree(d, ignore_errors=True)
            removed.append(d.name)
    return removed
