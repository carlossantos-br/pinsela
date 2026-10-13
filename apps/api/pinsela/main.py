from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import Response

from pinsela.config import get_settings
from pinsela.db import SessionLocal
from pinsela.security import is_cross_site_unsafe_request
from pinsela.services.draft_pack_queue import start_draft_pack_worker, stop_draft_pack_worker
from pinsela.services.templates import ensure_default_template

from pinsela.api.routers import (
    agent,
    agent_analyze,
    agent_bg,
    agent_diff,
    agent_macros,
    agent_preview,
    agent_web,
    assets,
    automation_templates,
    auth,
    jobs,
    live_events,
    projects,
    render,
    templates,
)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="PINSELA API", version="0.1.0")

    # CORS: kept configurable for REAL plugin usage. In current setup, UI is served by the backend itself.
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    # "*" with credentials amounts to reflecting any origin: never combine them.
    origins = [o for o in origins if o != "*"]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    allowed_origin_set = {o.lower().rstrip("/") for o in origins}

    @app.middleware("http")
    async def reject_cross_site_writes(request, call_next):  # type: ignore[no-untyped-def]
        # "Simple" cross-site requests reach localhost without a preflight and, in
        # loopback mode of the /api/agent/* endpoints, there is no cookie/CSRF to stop them.
        if is_cross_site_unsafe_request(request, allowed_origin_set):
            return JSONResponse({"detail": "cross_site_request_blocked"}, status_code=403)
        return await call_next(request)

    @app.middleware("http")
    async def harden_response_headers(request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if settings.pinsela_env == "prod":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
        return response

    # Static UI assets
    ui_dist = Path(settings.ui_dist_dir)
    assets_dir = ui_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
        app.mount("/v2/assets", StaticFiles(directory=str(assets_dir)), name="assets_v2")

    # API routers (both /api/* and /v2/api/* for local direct access)
    app.include_router(auth.router)
    app.include_router(jobs.router)
    app.include_router(automation_templates.router)
    app.include_router(projects.router)
    app.include_router(templates.router)
    app.include_router(assets.router)
    app.include_router(render.router)
    app.include_router(agent.router)
    app.include_router(agent_bg.router)
    app.include_router(agent_macros.router)
    app.include_router(agent_web.router)
    app.include_router(agent_diff.router)
    app.include_router(agent_preview.router)
    app.include_router(agent_analyze.router)
    app.include_router(live_events.router)

    from fastapi import APIRouter

    v2 = APIRouter(prefix="/v2")
    v2.include_router(auth.router)
    v2.include_router(jobs.router)
    v2.include_router(automation_templates.router)
    v2.include_router(projects.router)
    v2.include_router(templates.router)
    v2.include_router(assets.router)
    v2.include_router(render.router)
    v2.include_router(agent.router)
    v2.include_router(agent_bg.router)
    v2.include_router(agent_macros.router)
    v2.include_router(agent_web.router)
    v2.include_router(agent_diff.router)
    v2.include_router(agent_preview.router)
    v2.include_router(agent_analyze.router)
    v2.include_router(live_events.router)
    app.include_router(v2)

    # Static preview (hot-reload UI from agent_preview)
    _preview_static_dir = Path(__file__).resolve().parent / "static"
    if _preview_static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(_preview_static_dir)), name="static")

    @app.get("/preview")
    def _preview_redirect() -> RedirectResponse:
        return RedirectResponse(url="/static/preview.html", status_code=307)

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "service": "pinsela",
        }

    @app.on_event("startup")
    def _startup() -> None:
        # Ensure server directories exist
        Path(settings.server_data_root).mkdir(parents=True, exist_ok=True)
        (Path(settings.server_data_root) / "exports").mkdir(parents=True, exist_ok=True)
        (Path(settings.server_data_root) / "assets").mkdir(parents=True, exist_ok=True)
        (Path(settings.server_data_root) / "templates").mkdir(parents=True, exist_ok=True)
        (Path(settings.server_data_root) / "projects").mkdir(parents=True, exist_ok=True)
        (Path(settings.server_data_root) / "automation_templates").mkdir(parents=True, exist_ok=True)

        with SessionLocal() as db:
            try:
                ensure_default_template(db)
                db.commit()
            except SQLAlchemyError as exc:
                raise RuntimeError(
                    "Failed to access the database schema. Run `alembic upgrade head` before starting the API."
                ) from exc

        start_draft_pack_worker()

    @app.on_event("shutdown")
    def _shutdown() -> None:
        stop_draft_pack_worker()

    def _index_file() -> Path | None:
        idx = ui_dist / "index.html"
        return idx if idx.exists() else None

    def _resolve_ui_static_file(full_path: str) -> Path | None:
        if not full_path:
            return None
        base = ui_dist.resolve()
        rel_candidates = [full_path]
        # Direct /v2 access keeps the prefix; try the dist path without it too.
        if full_path.startswith("v2/"):
            rel_candidates.append(full_path[3:])
        for rel in rel_candidates:
            rel = str(rel or "").strip().lstrip("/")
            if not rel:
                continue
            candidate = (ui_dist / rel).resolve()
            try:
                candidate.relative_to(base)
            except ValueError:
                continue
            try:
                if candidate.is_file():
                    return candidate
            except PermissionError:
                # Ignore inaccessible files under dist and keep SPA fallback.
                continue
        return None

    @app.get("/")
    def ui_root() -> Response:
        idx = _index_file()
        if not idx:
            return Response(content="PINSELA API (UI not built)", media_type="text/plain")
        return FileResponse(str(idx))

    @app.get("/v2")
    @app.get("/v2/")
    def ui_v2_root() -> Response:
        return ui_root()

    # SPA fallback: Nginx strips /v2/ when proxying, so client routes arrive at backend as /<route>.
    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> Response:
        static_file = _resolve_ui_static_file(full_path)
        if static_file is not None:
            return FileResponse(str(static_file))
        if (
            full_path.startswith("api")
            or full_path.startswith("assets")
            or full_path.startswith("v2/api")
            or full_path.startswith("v2/assets")
            or full_path == "health"
        ):
            raise HTTPException(status_code=404, detail="Not found")
        idx = _index_file()
        if not idx:
            raise HTTPException(status_code=404, detail="UI not built")
        return FileResponse(str(idx))

    return app


app = create_app()
