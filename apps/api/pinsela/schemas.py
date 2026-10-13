from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


class RegisterResponse(BaseModel):
    ok: bool
    message: str


class LoginResponse(BaseModel):
    ok: bool
    username: str


class CreateArtworksRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=200)
    template_key: str = Field(default="master")
    content: dict[str, Any] = Field(default_factory=dict)
    render_local: bool = False
    output_kind: str = Field(default="jpg")


class CreateVersionRequest(BaseModel):
    artwork_id: uuid.UUID
    content_patch: dict[str, Any] = Field(default_factory=dict)
    render_local: bool = False
    output_kind: str = Field(default="jpg")


class JobSummary(BaseModel):
    id: uuid.UUID
    type: str
    status: str
    created_at: datetime
    updated_at: datetime
    artwork_id: uuid.UUID | None = None
    artwork_version_id: uuid.UUID | None = None


class JobStepOut(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    attempt: int
    max_attempts: int
    run_after: datetime
    input: dict[str, Any]
    output: dict[str, Any]
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class ApprovalOut(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    kind: str
    status: str
    before: dict[str, Any]
    after: dict[str, Any]
    diff: dict[str, Any]
    created_at: datetime
    decided_at: datetime | None = None
    decision_justification: str | None = None


class ArtworkSummary(BaseModel):
    id: uuid.UUID
    template_id: uuid.UUID
    template_key: str
    template_name: str | None = None
    display_name: str
    category: str | None
    tags: list[str]
    official_version_id: uuid.UUID | None
    preview_export_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class ArtworkVersionOut(BaseModel):
    id: uuid.UUID
    version_number: int
    content: dict[str, Any]
    figma_file_key: str | None
    figma_frame_id: str | None
    figma_report: dict[str, Any]
    created_at: datetime


class ExportAssetOut(BaseModel):
    id: uuid.UUID
    kind: str
    server_path: str
    sha256: str
    bytes: int
    width: int
    height: int
    official_path: str | None
    official_url: str | None
    is_official_copy: bool
    created_at: datetime


class ArtworkDetail(BaseModel):
    artwork: ArtworkSummary
    versions: list[ArtworkVersionOut]
    exports_by_version: dict[str, list[ExportAssetOut]]


class TemplateOut(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    engine_type: str = "svg_manifest_v1"
    locked: bool = False
    schema_json: dict[str, Any]
    figma_mapping_json: dict[str, Any]


class TemplateLiteOut(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    engine_type: str = "svg_manifest_v1"
    locked: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    canvas_width: int | None = None
    canvas_height: int | None = None
