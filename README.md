# Pinsela

**An open-source visual design editor that runs on your own machine.** Lay out
posts, stories, banners and A4 pages on a canvas, with autosave and export to
PNG, JPG, WEBP and PDF.

[MIT License](LICENSE)

## What it does

- **Projects.** A projects page with folders, rename, duplicate and delete
  (with confirmation), and a preview card for each project. Everything is saved
  automatically.
- **Editor.** Text, shapes, lines, images and SVG on a canvas, with layers,
  alignment, effects, undo/redo and rulers.
- **Multiple pages per project.** Add, rename, reorder and delete pages; the
  page order is the export order.
- **Templates.** Six built-in starting points, or start from a blank page in a
  preset size (post, story, portrait, banner, A4) or a custom one.
- **Export.** PNG, JPG, WEBP (one ZIP) or PDF, at 1x to 6x, with an optional
  transparent background. Export runs in the browser.
- **Background removal.** Select an image and use "Remove background". It runs
  entirely in the browser (WebGPU, with a WASM fallback). Nothing is uploaded
  for processing.
- **Local by design.** In dev mode there is no sign-up: the app signs you in to
  a local account through a loopback-only endpoint.

## Requirements

- **Node.js** 20 or newer (22 is what CI uses).
- **Python** 3.11 or 3.12.
- A browser with WebGPU for faster background removal (optional).

## Run from source

Backend (FastAPI + SQLite), in one terminal:

```sh
cd apps/api
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
uvicorn pinsela.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend (Vite), in another one:

```sh
cd ui
npm ci
cp .env.example .env
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend
(`VITE_PROXY_API_TARGET` in `ui/.env`). In dev, no configuration is needed:
the backend generates its own session secret and local login. To change
settings, copy `apps/api/.env.v2.example` to `apps/api/.env.v2`. A production
setup (`PINSELA_ENV=prod`) requires PostgreSQL, a session secret and an admin
password hash; see that file.

## Data location

Projects, assets, exports and the SQLite database live in `apps/api/data/`
(git-ignored). The variables that matter:

| Variable | Purpose |
|---|---|
| `PINSELA_SERVER_DATA_ROOT` | Data directory (default `apps/api/data`) |
| `PINSELA_DATABASE_URL` | Database URL (default: SQLite inside the data dir) |
| `PINSELA_FONT_DIRS` | Extra font directories for the server renderer |
| `PINSELA_CORS_ORIGINS` | Allowed origins when the UI is on another origin |

## Tests

```sh
cd ui
npx tsc --noEmit -p .
npx tsx src/pinsela/core/__tests__/run.ts

cd ../apps/api
pytest -q
```

## Fonts

Only SIL Open Font License fonts are bundled, as latin-subset WOFF2 files in
`ui/public/fonts/google/`. The families and their copyright lines are in
[`ui/public/fonts/FONTS.md`](ui/public/fonts/FONTS.md) and the license text is
`ui/public/fonts/google/OFL.txt`.

## Background removal model

The model is [`onnx-community/ormbg-ONNX`](https://huggingface.co/onnx-community/ormbg-ONNX)
(Apache-2.0), run with transformers.js and onnxruntime-web. Both libraries and
the WASM runtime are bundled with the app. Only the model weights are
downloaded, once, from Hugging Face on first use, and then kept in the browser
cache.

## License

[MIT](LICENSE)
