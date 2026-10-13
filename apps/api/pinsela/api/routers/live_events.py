"""Live-events SSE + agent presence (spec 2026-06-22 §5).

- GET  /api/agent/events   → stream text/event-stream (doc-changed, presence, ping)
- POST /api/agent/presence → the agent announces working/idle on an artwork

Auth: admin session (the editor uses EventSource with a cookie) OR agent principal
(token / loopback with a local Host), like the other /api/agent/* routes.
"""
from __future__ import annotations

import asyncio
import json
import queue
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from pinsela.api.routers.agent import require_agent_principal
from pinsela.auth import get_admin_principal
from pinsela.services import live_bus


def require_admin_or_agent(request: Request) -> str:
    try:
        get_admin_principal(request)
        return "admin"
    except HTTPException:
        pass
    try:
        return require_agent_principal(request)
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


router = APIRouter(prefix="/api/agent", tags=["live"], dependencies=[Depends(require_admin_or_agent)])

_POLL_SECONDS = 0.25
_HEARTBEAT_EVERY = 40  # ~10s


class PresenceIn(BaseModel):
    key: str
    state: str  # "working" | "idle"
    label: str | None = None


@router.post("/presence")
def post_presence(req: PresenceIn) -> dict[str, Any]:
    live_bus.set_presence(req.key, req.state, req.label)
    return {"ok": True, "key": req.key, "state": req.state}


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    q = live_bus.subscribe()

    async def gen():
        try:
            # Initial presence snapshot so the editor syncs on connect.
            yield _sse({"type": "hello", "presence": live_bus.current_presence()})
            ticks = 0
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = q.get_nowait()
                    yield _sse(item)
                    continue
                except queue.Empty:
                    pass
                ticks += 1
                if ticks % _HEARTBEAT_EVERY == 0:
                    yield _sse({"type": "ping"})
                await asyncio.sleep(_POLL_SECONDS)
        finally:
            live_bus.unsubscribe(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
