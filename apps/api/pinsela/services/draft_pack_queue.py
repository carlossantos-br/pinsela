from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from pinsela.config import get_settings
from pinsela.services.pinsela_package import PINSELA_FILENAME, read_pinsela_package, write_pinsela_package

_WORKER: threading.Thread | None = None
_STOP_EVENT: threading.Event | None = None
_WORKER_LOCK = threading.Lock()


def _queue_root() -> Path:
    settings = get_settings()
    root = Path(settings.server_data_root) / "_draft_pack_queue"
    (root / "pending").mkdir(parents=True, exist_ok=True)
    (root / "failed").mkdir(parents=True, exist_ok=True)
    return root


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".tmp-{path.name}-{uuid.uuid4().hex}"
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def enqueue_draft_pack_job(*, template_key: str, draft_root: Path) -> str:
    queue_root = _queue_root()
    job_id = str(uuid.uuid4())
    payload = {
        "job_id": job_id,
        "template_key": str(template_key or "").strip().lower(),
        "draft_root": str(draft_root),
        "attempts": 0,
        "next_run_at": time.time(),
        "created_at": time.time(),
    }
    _atomic_write_text(
        queue_root / "pending" / f"{job_id}.json",
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    )
    return job_id


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists() or not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return raw if isinstance(raw, dict) else None


def _write_draft_package(draft_root: Path) -> None:
    doc_path = draft_root / "doc.json"
    meta_path = draft_root / "pack.meta.json"
    if not doc_path.exists() or not meta_path.exists():
        raise FileNotFoundError("draft_missing_core_files")

    doc_json = _load_json(doc_path)
    meta_json = _load_json(meta_path) or {}
    if not isinstance(doc_json, dict):
        raise ValueError("draft_invalid_doc_json")

    preview_path = draft_root / "preview.png"
    preview_bytes = preview_path.read_bytes() if preview_path.exists() and preview_path.is_file() else None

    existing = read_pinsela_package(draft_root / PINSELA_FILENAME)
    schema_json = existing.get("schema_json") if isinstance(existing, dict) and isinstance(existing.get("schema_json"), dict) else None
    mapping_json = existing.get("mapping_json") if isinstance(existing, dict) and isinstance(existing.get("mapping_json"), dict) else None

    write_pinsela_package(
        draft_root / PINSELA_FILENAME,
        doc_json=doc_json,
        schema_json=schema_json,
        mapping_json=mapping_json,
        metadata=meta_json,
        preview_png=preview_bytes,
    )


def run_pending_pack_jobs_once(*, max_jobs: int = 4) -> int:
    queue_root = _queue_root()
    pending_dir = queue_root / "pending"
    failed_dir = queue_root / "failed"
    now = time.time()

    files = sorted(pending_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
    processed = 0
    for job_path in files:
        if processed >= max_jobs:
            break
        payload = _load_json(job_path)
        if not payload:
            try:
                job_path.unlink()
            except Exception:
                pass
            continue

        next_run_at = float(payload.get("next_run_at") or 0.0)
        if next_run_at > now:
            continue

        draft_root = Path(str(payload.get("draft_root") or "").strip())
        attempts = int(payload.get("attempts") or 0)
        processed += 1
        try:
            _write_draft_package(draft_root)
            try:
                job_path.unlink()
            except Exception:
                pass
        except Exception as exc:
            attempts += 1
            payload["attempts"] = attempts
            payload["last_error"] = f"{type(exc).__name__}: {exc}"
            payload["next_run_at"] = now + min(60.0, float(2**attempts))
            if attempts >= 6:
                try:
                    os.replace(job_path, failed_dir / job_path.name)
                except Exception:
                    pass
                _atomic_write_text(
                    failed_dir / job_path.name,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                )
            else:
                _atomic_write_text(job_path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return processed


def _worker_loop(stop_event: threading.Event, poll_interval_s: float) -> None:
    while not stop_event.is_set():
        try:
            run_pending_pack_jobs_once(max_jobs=8)
        except Exception:
            # Queue failures are non-fatal to API; job files keep retry metadata.
            pass
        stop_event.wait(timeout=poll_interval_s)


def start_draft_pack_worker(*, poll_interval_s: float = 1.0) -> None:
    global _WORKER, _STOP_EVENT
    with _WORKER_LOCK:
        if _WORKER is not None and _WORKER.is_alive():
            return
        stop_event = threading.Event()
        t = threading.Thread(
            target=_worker_loop,
            args=(stop_event, poll_interval_s),
            name="pinsela-draft-pack-worker",
            daemon=True,
        )
        t.start()
        _WORKER = t
        _STOP_EVENT = stop_event


def stop_draft_pack_worker(*, timeout_s: float = 3.0) -> None:
    global _WORKER, _STOP_EVENT
    with _WORKER_LOCK:
        stop_event = _STOP_EVENT
        worker = _WORKER
        _STOP_EVENT = None
        _WORKER = None
    if stop_event is not None:
        stop_event.set()
    if worker is not None and worker.is_alive():
        worker.join(timeout=timeout_s)

