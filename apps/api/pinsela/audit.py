from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from pinsela.models import AuditEvent


def log_event(
    db: Session,
    *,
    event: str,
    level: str = "INFO",
    job_id: uuid.UUID | None = None,
    artwork_id: uuid.UUID | None = None,
    artwork_version_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    ev = AuditEvent(
        level=level,
        event=event,
        job_id=job_id,
        artwork_id=artwork_id,
        artwork_version_id=artwork_version_id,
        details=details or {},
    )
    db.add(ev)

