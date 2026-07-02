"""
backend/app/schemas/projects.py

Request/response schemas for project and queue endpoints.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ── Projects ─────────────────────────────────────────────────────────────────

class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    description: str | None = Field(default=None, max_length=1000)


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)


class ProjectResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    slug: str
    description: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Queues ────────────────────────────────────────────────────────────────────

RetryStrategy = Literal["fixed", "linear", "exponential"]


class QueueCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    description: str | None = Field(default=None, max_length=1000)
    max_workers: int = Field(default=1, ge=1, le=100)
    retry_limit: int = Field(default=3, ge=0, le=50)
    retry_strategy: RetryStrategy = "exponential"
    retry_delay_seconds: int = Field(default=60, ge=1)


class QueueUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    max_workers: int | None = Field(default=None, ge=1, le=100)
    retry_limit: int | None = Field(default=None, ge=0, le=50)
    retry_strategy: RetryStrategy | None = None
    retry_delay_seconds: int | None = Field(default=None, ge=1)
    is_paused: bool | None = None


class QueueResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    slug: str
    description: str | None
    max_workers: int
    retry_limit: int
    retry_strategy: str
    retry_delay_seconds: int
    is_paused: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
