from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from pinsela.config import get_settings


def make_engine():
    settings = get_settings()
    database_url = str(settings.database_url or "").strip()
    is_postgres = database_url.startswith("postgresql")
    engine_kwargs: dict[str, object] = {
        "pool_pre_ping": True,
        "future": True,
    }
    if is_postgres:
        # Production-oriented pool defaults for bursty autosave + background jobs.
        engine_kwargs.update(
            {
                "pool_size": 10,
                "max_overflow": 20,
                "pool_timeout": 30,
                "pool_recycle": 1800,
            }
        )
    return create_engine(
        database_url,
        **engine_kwargs,
    )


ENGINE = make_engine()
SessionLocal = sessionmaker(bind=ENGINE, autocommit=False, autoflush=True, class_=Session, future=True)


def db_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
