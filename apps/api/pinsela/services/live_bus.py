"""Live-events bus (spec 2026-06-22 §5) — local, single-user.

In-memory, thread-safe pub/sub (stdlib queue.Queue) to push live-version
changes and agent presence to the open editor via SSE. No FastAPI
dependency here — the router (live_events) and the write engine (templates) import
this module, avoiding coupling routers to each other.

Publishing comes from SYNC code (routes in the threadpool); consumption is an
async generator that does non-blocking polling of the queue — without crossing event loops.
"""
from __future__ import annotations

import queue
from typing import Any

# Each subscriber (one SSE connection) has its own queue.
_subscribers: list["queue.Queue[dict[str, Any]]"] = []

# Last presence state per artwork (key -> {"state","label"}).
_presence: dict[str, dict[str, Any]] = {}


def subscribe() -> "queue.Queue[dict[str, Any]]":
    q: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=2000)
    _subscribers.append(q)
    return q


def unsubscribe(q: "queue.Queue[dict[str, Any]]") -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


def publish_event(event_type: str, **data: Any) -> None:
    """Pushes an event to all subscribers. Never raises (best-effort)."""
    payload = {"type": event_type, **data}
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except queue.Full:
            # Slow/stuck subscriber: drop the connection.
            unsubscribe(q)
        except Exception:
            unsubscribe(q)


def set_presence(key: str, state: str, label: str | None = None) -> None:
    """Marks an artwork as 'agent working/idle' and propagates it."""
    norm_state = "working" if str(state).strip().lower() == "working" else "idle"
    if norm_state == "idle":
        _presence.pop(key, None)
    else:
        _presence[key] = {"state": norm_state, "label": label}
    publish_event("presence", key=key, state=norm_state, label=label)


def current_presence() -> dict[str, dict[str, Any]]:
    return {k: dict(v) for k, v in _presence.items()}


def subscriber_count() -> int:
    return len(_subscribers)
