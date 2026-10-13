from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from pinsela.audit import log_event
from pinsela.models import Job, JobStatus, JobStep, JobType, StepStatus


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_output_kind(raw: str | None) -> str:
    k = str(raw or "").strip().lower()
    if k == "jpeg":
        k = "jpg"
    if k not in {"png", "jpg"}:
        return "jpg"
    return k


def create_job(
    db: Session,
    *,
    job_type: JobType,
    payload: dict[str, Any],
    artwork_id: uuid.UUID | None = None,
    artwork_version_id: uuid.UUID | None = None,
) -> Job:
    job = Job(
        type=job_type.value,
        status=JobStatus.queued.value,
        payload=payload,
        artwork_id=artwork_id,
        artwork_version_id=artwork_version_id,
        started_at=None,
        finished_at=None,
    )
    db.add(job)
    db.flush()
    log_event(
        db,
        event="job.created",
        job_id=job.id,
        artwork_id=artwork_id,
        artwork_version_id=artwork_version_id,
        details={"type": job.type},
    )
    return job


def add_step(db: Session, *, job: Job, name: str, input: dict[str, Any] | None = None, status: StepStatus = StepStatus.queued) -> JobStep:
    step = JobStep(
        job_id=job.id,
        name=name,
        status=status.value,
        input=input or {},
        run_after=_now(),
    )
    db.add(step)
    db.flush()
    return step


def enqueue_create_artworks(
    db: Session,
    *,
    count: int,
    template_key: str,
    content: dict[str, Any] | None = None,
    render_local: bool = False,
    output_kind: str = "jpg",
) -> Job:
    kind = _normalize_output_kind(output_kind)
    job = create_job(
        db,
        job_type=JobType.create_artworks,
        payload={
            "count": count,
            "template_key": template_key,
            "content": content or {},
            "render_local": bool(render_local),
            "output_kind": kind,
        },
    )
    add_step(db, job=job, name="CREATE_ARTWORKS", input={})
    return job


def enqueue_create_version(
    db: Session,
    *,
    artwork_id: uuid.UUID,
    content_patch: dict[str, Any],
    render_local: bool = False,
    output_kind: str = "jpg",
) -> Job:
    kind = _normalize_output_kind(output_kind)
    job = create_job(
        db,
        job_type=JobType.create_version,
        payload={
            "artwork_id": str(artwork_id),
            "content_patch": content_patch,
            "render_local": bool(render_local),
            "output_kind": kind,
        },
        artwork_id=artwork_id,
    )
    add_step(db, job=job, name="CREATE_VERSION_RECORD", input={})
    return job
