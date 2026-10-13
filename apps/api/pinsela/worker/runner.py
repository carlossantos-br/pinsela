from __future__ import annotations

import random
import time
import traceback
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from pinsela.audit import log_event
from pinsela.config import get_settings
from pinsela.db import SessionLocal
from pinsela.models import Job, JobStatus, JobStep, StepStatus
from pinsela.pipeline.handlers import HANDLERS


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _backoff_seconds(attempt: int) -> int:
    base = min(300, 2 ** max(0, attempt))  # up to 5 minutes
    jitter = random.randint(0, 3)
    return base + jitter


def _recompute_job_status(db: Session, job: Job) -> None:
    # Ensure the DB view used by the status query includes the latest step updates.
    db.flush()
    statuses = [s for (s,) in db.query(JobStep.status).filter(JobStep.job_id == job.id).all()]
    if any(s == StepStatus.failed.value for s in statuses):
        job.status = JobStatus.failed.value
        job.finished_at = _now()
        return

    if any(s == StepStatus.waiting_approval.value for s in statuses):
        # This job is blocked by approval flow.
        job.status = JobStatus.waiting_approval.value
        return

    if any(s in (StepStatus.queued.value, StepStatus.running.value) for s in statuses):
        job.status = JobStatus.running.value
        if job.started_at is None:
            job.started_at = _now()
        return

    # All steps succeeded or canceled.
    job.status = JobStatus.done.value
    job.finished_at = _now()


def _pick_next_step(db: Session) -> JobStep | None:
    return (
        db.query(JobStep)
        .filter(JobStep.status == StepStatus.queued.value, JobStep.run_after <= _now())
        .order_by(JobStep.run_after.asc(), JobStep.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
        .one_or_none()
    )


def run_once() -> bool:
    settings = get_settings()
    if not settings.pipeline_v2_enabled:
        time.sleep(1.0)
        return False

    with SessionLocal() as db:
        step = _pick_next_step(db)
        if not step:
            time.sleep(0.35)
            return False

        job = db.query(Job).filter(Job.id == step.job_id).one()

        handler = HANDLERS.get(step.name)
        if handler is None:
            step.status = StepStatus.failed.value
            step.error = f"Unknown step handler: {step.name}"
            job.status = JobStatus.failed.value
            job.error = step.error
            log_event(db, event="step.unknown", level="ERROR", job_id=job.id, details={"step": step.name})
            db.commit()
            return True

        # Mark running
        step.status = StepStatus.running.value
        step.attempt += 1
        step.updated_at = _now()
        job.status = JobStatus.running.value
        job.started_at = job.started_at or _now()
        log_event(db, event="step.started", job_id=job.id, details={"step": step.name, "attempt": step.attempt})
        db.commit()

        try:
            with SessionLocal() as db2:
                step2 = db2.query(JobStep).filter(JobStep.id == step.id).one()
                job2 = db2.query(Job).filter(Job.id == step.job_id).one()
                out = handler(db2, job2, step2) or {}
                step2.output = out

                # Some handlers deliberately do not change the step status here.
                # If still running, mark succeeded.
                if step2.status == StepStatus.running.value:
                    step2.status = StepStatus.succeeded.value

                log_event(db2, event="step.succeeded", job_id=job2.id, details={"step": step2.name})
                _recompute_job_status(db2, job2)
                db2.commit()
                return True

        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            tb = traceback.format_exc(limit=20)

            with SessionLocal() as db3:
                step3 = db3.query(JobStep).filter(JobStep.id == step.id).one()
                job3 = db3.query(Job).filter(Job.id == step.job_id).one()
                step3.error = err
                step3.output = {"traceback": tb}

                if step3.attempt < step3.max_attempts:
                    step3.status = StepStatus.queued.value
                    step3.run_after = _now() + timedelta(seconds=_backoff_seconds(step3.attempt))
                    log_event(db3, event="step.retry_scheduled", level="WARN", job_id=job3.id, details={"step": step3.name, "attempt": step3.attempt, "error": err})
                else:
                    step3.status = StepStatus.failed.value
                    job3.status = JobStatus.failed.value
                    job3.error = err
                    job3.finished_at = _now()
                    log_event(db3, event="step.failed", level="ERROR", job_id=job3.id, details={"step": step3.name, "attempt": step3.attempt, "error": err})

                db3.commit()
                return True


def run_forever() -> None:
    while True:
        run_once()
