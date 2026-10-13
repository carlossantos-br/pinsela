from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JSON_VARIANT = JSON().with_variant(JSONB, "postgresql")
UUID_TYPE = Uuid(as_uuid=True)


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSON_VARIANT}


class JobStatus(str, Enum):
    draft = "DRAFT"
    validating = "VALIDATING"
    invalid = "INVALID"
    queued = "QUEUED"
    running = "RUNNING"
    waiting_approval = "WAITING_APPROVAL"
    done = "DONE"
    failed = "FAILED"
    canceled = "CANCELED"


class StepStatus(str, Enum):
    queued = "QUEUED"
    running = "RUNNING"
    waiting_approval = "WAITING_APPROVAL"
    succeeded = "SUCCEEDED"
    failed = "FAILED"
    canceled = "CANCELED"


class ApprovalStatus(str, Enum):
    pending = "PENDING"
    approved = "APPROVED"
    rejected = "REJECTED"


class JobType(str, Enum):
    create_artworks = "CREATE_ARTWORKS"
    create_version = "CREATE_VERSION"


class TemplateDefinition(Base):
    __tablename__ = "template_definitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    engine_type: Mapped[str] = mapped_column(String(32), nullable=False, default="svg_manifest_v1")
    engine_doc_json: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # JSON schema describing official fields, limits, and types.
    schema_json: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)

    # Binding schema for template variables (historical column name preserved for compatibility).
    figma_mapping_json: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    @property
    def binding_schema_json(self) -> dict:
        return self.figma_mapping_json if isinstance(self.figma_mapping_json, dict) else {}

    @binding_schema_json.setter
    def binding_schema_json(self, value: dict) -> None:
        self.figma_mapping_json = value if isinstance(value, dict) else {}


class UserAccount(Base):
    __tablename__ = "user_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Artwork(Base):
    __tablename__ = "artworks"

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, ForeignKey("template_definitions.id"), nullable=False)

    display_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON_VARIANT, nullable=False, default=list)

    official_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID_TYPE, ForeignKey("artwork_versions.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    template: Mapped[TemplateDefinition] = relationship()
    versions: Mapped[list["ArtworkVersion"]] = relationship(
        back_populates="artwork",
        order_by="ArtworkVersion.version_number",
        foreign_keys="ArtworkVersion.artwork_id",
    )
    official_version: Mapped["Optional[ArtworkVersion]"] = relationship(
        "ArtworkVersion",
        foreign_keys=[official_version_id],
        post_update=True,
        viewonly=True,
    )


class ArtworkVersion(Base):
    __tablename__ = "artwork_versions"
    __table_args__ = (UniqueConstraint("artwork_id", "version_number", name="uq_artwork_version_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    artwork_id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, ForeignKey("artworks.id"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Official fields as structured data (schema is per template_definition).
    content: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)

    # Historical render references + report columns preserved for compatibility.
    figma_file_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    figma_frame_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    figma_report: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    artwork: Mapped[Artwork] = relationship(back_populates="versions", foreign_keys=[artwork_id])
    exports: Mapped[list["ExportAsset"]] = relationship(back_populates="version")

    @property
    def render_report(self) -> dict:
        return self.figma_report if isinstance(self.figma_report, dict) else {}

    @render_report.setter
    def render_report(self, value: dict) -> None:
        self.figma_report = value if isinstance(value, dict) else {}


class ExportAsset(Base):
    __tablename__ = "export_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    artwork_version_id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, ForeignKey("artwork_versions.id"), nullable=False)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # png|jpg|pdf

    # Always keep a local backup path (server disk).
    server_path: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Official copy URL/path reference for published assets.
    official_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    official_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_official_copy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    version: Mapped[ArtworkVersion] = relationship(back_populates="exports")


class InputAsset(Base):
    """
    User-uploaded assets used as inputs to the template pipeline (hero + device slots).

    Stored on server disk for now (demo/staging). A future evolution can move these
    to remote storage while keeping the stable UUID reference in content.
    """

    __tablename__ = "input_assets"
    __table_args__ = (
        Index("ix_input_assets_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="image")  # image

    name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON_VARIANT, nullable=False, default=list)

    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    ext: Mapped[str] = mapped_column(String(16), nullable=False)

    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    server_path: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=JobStatus.draft.value)

    payload: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    result: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    artwork_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID_TYPE, ForeignKey("artworks.id"), nullable=True)
    artwork_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID_TYPE, ForeignKey("artwork_versions.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    steps: Mapped[list["JobStep"]] = relationship(back_populates="job", order_by="JobStep.created_at")


class JobStep(Base):
    __tablename__ = "job_steps"
    __table_args__ = (
        Index("ix_job_steps_status_run_after", "status", "run_after"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, ForeignKey("jobs.id"), nullable=False)

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=StepStatus.queued.value)

    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    input: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    output: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    job: Mapped[Job] = relationship(back_populates="steps")


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"
    __table_args__ = (
        Index("ix_approval_requests_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, ForeignKey("jobs.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=ApprovalStatus.pending.value)

    before: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    after: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    diff: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)

    decision_justification: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_job", "job_id", "created_at"),
        Index("ix_audit_events_artwork", "artwork_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="INFO")
    event: Mapped[str] = mapped_column(String(64), nullable=False)

    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID_TYPE, nullable=True)
    artwork_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID_TYPE, nullable=True)
    artwork_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID_TYPE, nullable=True)

    details: Mapped[dict] = mapped_column(JSON_VARIANT, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
