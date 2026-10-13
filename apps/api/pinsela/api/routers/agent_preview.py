"""Agent hot-reload preview router.

Provides a Server-Sent Events (SSE) channel so the agent loop can push a
fresh PNG render to every connected browser the instant a new doc lands.

The flow:

    agent -> POST /api/agent/preview/render-and-broadcast {doc, ...}
                 |
                 +--> render PNG -> save to apps/api/data/preview/<sha8>.png
                 |
                 +--> broadcast {url, sha256, width, height, bytes, doc_meta}
                                via SSE to every subscriber
    browser <- GET /api/agent/preview/stream  (text/event-stream)
            <- event: render data: {...}
            <- event: status data: {...}  (heartbeat every 10s)

Late-arriving clients can fetch `GET /api/agent/preview/latest` to bootstrap.

Auth reuses ``require_agent_principal`` from agent.py for the WRITE endpoint
(render-and-broadcast) and for the metadata endpoints. The SSE stream and the
static PNG-serve endpoint are open on loopback so the browser does not need to
ship the X-Agent-Token header — both treat absence of a token gracefully and
fall back to loopback enforcement when `PINSELA_AGENT_TOKEN` is unset.

Mount from main.py exactly like ``agent.router``.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from starlette.responses import Response, StreamingResponse

from pinsela.api.routers.agent import (
    _apply_scale_and_background,
    require_agent_principal,
)
from pinsela.config import default_data_root, get_settings
from pinsela.security import is_trusted_local_request
from pinsela.services.render_engine_native import (
    NativeRenderEngineError,
    render_native_template,
)
from pinsela.services.template_native import validate_native_doc


router = APIRouter(prefix="/api/agent/preview", tags=["agent", "preview"])


# --------------------------------------------------------------------------- #
# Storage paths.
# --------------------------------------------------------------------------- #

PREVIEW_DIR = default_data_root() / "preview"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- #
# In-memory pub/sub hub.
#
# A single ``PreviewHub`` is instantiated at module import time. Each SSE
# subscriber gets its own ``asyncio.Queue`` so a slow client cannot back up
# the producers. Queues are bounded to keep memory predictable; if a client
# falls too far behind we drop the oldest message.
# --------------------------------------------------------------------------- #


class PreviewHub:
    """Tiny single-process pub/sub for SSE subscribers."""

    def __init__(self, max_queue: int = 16) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._max_queue = max_queue
        self._lock = asyncio.Lock()
        self._latest: dict[str, Any] | None = None

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(
            maxsize=self._max_queue
        )
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    async def broadcast(self, event: str, payload: dict[str, Any]) -> int:
        """Fan-out a message. Returns the number of queues delivered to."""
        msg = {"event": event, "payload": payload}
        if event == "render":
            self._latest = payload
        async with self._lock:
            targets = list(self._subscribers)
        delivered = 0
        for q in targets:
            try:
                q.put_nowait(msg)
                delivered += 1
            except asyncio.QueueFull:
                # Drop oldest, then push.
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(msg)
                    delivered += 1
                except asyncio.QueueFull:
                    continue
        return delivered

    def connected_clients(self) -> int:
        return len(self._subscribers)

    def latest(self) -> dict[str, Any] | None:
        return self._latest


HUB = PreviewHub()


# --------------------------------------------------------------------------- #
# Request models.
# --------------------------------------------------------------------------- #


class RenderBroadcastRequest(BaseModel):
    doc: dict[str, Any]
    payload: dict[str, Any] | None = None
    output_kind: Literal["png"] = "png"
    scale: float = Field(default=1.0, ge=0.25, le=4.0)
    background_mode: Literal["as-is", "transparent", "white"] = "as-is"
    label: str | None = None


# --------------------------------------------------------------------------- #
# Auth helpers.
#
# The SSE stream and the PNG-serve endpoint are GETs hit by a plain <img>/
# <EventSource> from the browser — neither can send custom headers
# conveniently — so they are loopback-only and never require a token. The
# write endpoint reuses the standard agent auth dependency.
# --------------------------------------------------------------------------- #


_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _require_loopback_or_token(request: Request) -> str:
    """Accept loopback OR a valid X-Agent-Token (querystring 'token' allowed)."""
    settings = get_settings()
    token = getattr(settings, "agent_token", None)
    if token:
        supplied = (
            str(request.headers.get("X-Agent-Token") or "").strip()
            or str(request.query_params.get("token") or "").strip()
        )
        if supplied and hmac.compare_digest(supplied, token):
            return "token"
    # Peer loopback E Host local (anti DNS rebinding / proxy reverso).
    if is_trusted_local_request(request):
        return "loopback"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="loopback_required",
    )


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #


def _summarise_doc(doc: dict[str, Any]) -> dict[str, Any]:
    canvas = doc.get("canvas") or {}
    nodes = doc.get("nodes") or []
    return {
        "version": doc.get("version"),
        "root_id": doc.get("root_id"),
        "canvas_width": canvas.get("width"),
        "canvas_height": canvas.get("height"),
        "node_count": len(nodes),
        "title": doc.get("title") or doc.get("name"),
    }


# --------------------------------------------------------------------------- #
# Endpoints.
# --------------------------------------------------------------------------- #


@router.post("/render-and-broadcast")
async def render_and_broadcast(
    req: RenderBroadcastRequest,
    _principal: str = Depends(require_agent_principal),
) -> dict[str, Any]:
    """Render the inline doc, persist PNG, broadcast SSE event."""
    try:
        validated = validate_native_doc(req.doc)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"invalid_doc:{exc}")

    payload = req.payload or {}
    bg_mode = str(req.background_mode or "as-is")
    started = time.monotonic()
    try:
        rendered = render_native_template(
            validated, payload, db=None, background_mode=bg_mode
        )
    except NativeRenderEngineError as exc:
        raise HTTPException(status_code=500, detail=f"render_failed:{exc}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"render_failed:{exc}")

    raw_png, _meta = rendered["png"]
    out_bytes, width, height = _apply_scale_and_background(
        raw_png,
        ext="png",
        scale=float(req.scale or 1.0),
        background_mode=bg_mode,
    )

    sha = hashlib.sha256(out_bytes).hexdigest()
    sha8 = sha[:8]
    fname = f"{sha8}.png"
    fpath = PREVIEW_DIR / fname
    # Write atomically: <sha8>.tmp -> rename.
    tmp_path = fpath.with_suffix(".png.tmp")
    tmp_path.write_bytes(out_bytes)
    tmp_path.replace(fpath)

    duration_ms = int(round((time.monotonic() - started) * 1000))

    record = {
        "url": f"/api/agent/preview/{fname}",
        "sha256": sha,
        "sha8": sha8,
        "filename": fname,
        "width": width,
        "height": height,
        "bytes": len(out_bytes),
        "duration_ms": duration_ms,
        "background_mode": bg_mode,
        "scale": float(req.scale or 1.0),
        "label": req.label,
        "ts": time.time(),
        "doc_meta": _summarise_doc(validated),
    }
    delivered = await HUB.broadcast("render", record)
    return {
        "ok": True,
        "delivered": delivered,
        "connected_clients": HUB.connected_clients(),
        "render": record,
    }


@router.get("/latest")
def get_latest(
    _principal: str = Depends(_require_loopback_or_token),
) -> dict[str, Any]:
    """Return the most recently broadcast render record (or null)."""
    return {
        "ok": True,
        "latest": HUB.latest(),
        "connected_clients": HUB.connected_clients(),
    }


@router.get("/stream")
async def sse_stream(
    request: Request,
    _principal: str = Depends(_require_loopback_or_token),
) -> StreamingResponse:
    """SSE channel. Emits `render` events on broadcast and `status` heartbeats."""
    queue = await HUB.subscribe()

    async def event_gen():
        last_heartbeat = time.monotonic()
        # Send an initial status frame so the page knows it is connected.
        yield _format_sse(
            "status",
            {
                "connected_clients": HUB.connected_clients(),
                "last_render_ts": (HUB.latest() or {}).get("ts"),
                "msg": "connected",
            },
        )
        # If we already have a render, push it immediately so the page is
        # not blank for late joiners.
        latest = HUB.latest()
        if latest is not None:
            yield _format_sse("render", latest)

        try:
            while True:
                if await request.is_disconnected():
                    break
                # Wait for next message OR heartbeat interval.
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=10.0)
                    yield _format_sse(msg["event"], msg["payload"])
                except asyncio.TimeoutError:
                    pass

                now = time.monotonic()
                if now - last_heartbeat >= 10.0:
                    last_heartbeat = now
                    yield _format_sse(
                        "status",
                        {
                            "connected_clients": HUB.connected_clients(),
                            "last_render_ts": (HUB.latest() or {}).get("ts"),
                            "msg": "heartbeat",
                        },
                    )
        finally:
            await HUB.unsubscribe(queue)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{filename}")
def serve_preview_file(
    filename: str,
    _principal: str = Depends(_require_loopback_or_token),
) -> Response:
    """Serve a persisted preview PNG.

    Path-traversal guard: only files matching `<8hex>.png` (or any plain
    basename without separators) inside PREVIEW_DIR are allowed.
    """
    if "/" in filename or ".." in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="bad_filename")
    fpath = PREVIEW_DIR / filename
    if not fpath.exists() or not fpath.is_file():
        raise HTTPException(status_code=404, detail="not_found")
    data = fpath.read_bytes()
    return Response(
        content=data,
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, must-revalidate",
            "X-Preview-Bytes": str(len(data)),
        },
    )


# --------------------------------------------------------------------------- #
# SSE wire format.
# --------------------------------------------------------------------------- #


def _format_sse(event: str, data: Any) -> str:
    """Encode a single SSE frame.

    Each frame is `event: <name>\\ndata: <json>\\n\\n`. Multi-line JSON would
    need a `data:` prefix per line, but we always emit single-line JSON so a
    single `data:` line is sufficient.
    """
    body = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {body}\n\n"
