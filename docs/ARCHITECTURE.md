# Architecture

## Layout

```
apps/api/                  FastAPI backend (Python 3.11+)
  pinsela/                  main.py, config.py, auth.py, routers in api/routers/, services in services/
  alembic/                 Database migrations
  tests/                   pytest (includes renderer golden PNGs in tests/golden/native)
  data/                    Default data root (ignored by git)
ui/                        React + Vite + TypeScript frontend
  src/pinsela/              Editor core (core, engine, hooks, design, ui/darkglass)
  src/pages/               Pages (projects, editor, login)
  public/fonts/google/     OFL fonts used by the editor and the server renderer
scripts/                   Local startup and utilities
  agent-tools/             Python CLIs for agents (canvas, macros, preview, background removal...)
docs/adr/                  Architecture decision records
```

## Data

Data root: `PINSELA_SERVER_DATA_ROOT` (default `apps/api/data`).

```
<root>/projects/<project_key>/native/   doc.json, project.pinsela, versions/, draft/
<root>/assets/                          uploads, named by UUID
<root>/exports/                         rendered exports
<root>/templates/                       templates
<root>/automation_templates/            automation templates
```

The database is SQLite by default (`PINSELA_DATABASE_URL=sqlite:///./data/app.db`);
Postgres is also supported.

## Environment variables

Read by `apps/api/pinsela/config.py` (see `apps/api/.env.v2.example`).

| Variable | Purpose |
|---|---|
| `PINSELA_DATABASE_URL` | SQLAlchemy connection |
| `PINSELA_SERVER_DATA_ROOT` | Data root (default `apps/api/data`) |
| `PINSELA_UI_DIST_DIR` | Frontend build served by the backend (default `ui/dist`) |
| `PINSELA_FONT_DIRS` | Extra font directories (`:`-separated) for the renderer |
| `PINSELA_SESSION_SECRET` | Session cookie secret |
| `PINSELA_AUTH_*` | Authentication (allowed emails, attempt limits) |
| `PINSELA_CORS_ORIGINS` | Allowed CORS origins |
| `PINSELA_PATTERN_DIR` | Patterns used by the agent CLIs (default `patterns/`) |

## Fonts

The frontend registers the fonts in `ui/public/fonts/google/` (`fontManifest.ts`).
The server renderer (`render_engine_native.py`) resolves the same family from
that folder in the repository and falls back to Inter when the requested family does not exist.

## Running locally

```bash
./scripts/local_start_pinsela.sh   # backend (8000) + frontend (5173)
./scripts/local_stop_pinsela.sh
```
