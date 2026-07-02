"""
backend/app/schemas/jobs.py

Request/response schemas for job and dead-letter-queue endpoints.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── Job creation ──────────────────────────────────────────────────────────────

class JobCreateRequest(BaseModel):
    """Create one job. For batch creation, POST a list of these to /jobs/batch."""

    job_type: str = Field(min_length=1, max_length=100)
    payload: dict = Field(default_factory=dict)
    priority: int = Field(default=0, ge=0, le=100)
    run_at: datetime | None = None          # None → run immediately
    cron_expression: str | None = None      # set for recurring jobs
    max_attempts: int = Field(default=3, ge=1, le=50)


class JobBatchCreateRequest(BaseModel):
    jobs: list[JobCreateRequest] = Field(min_length=1, max_length=500)


# ── Job responses ─────────────────────────────────────────────────────────────

class JobRunResponse(BaseModel):
    id: uuid.UUID
    worker_id: str
    attempt_number: int
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    error_message: str | None

    model_config = {"from_attributes": True}


class JobLogResponse(BaseModel):
    id: uuid.UUID
    level: str
    message: str
    logged_at: datetime

    model_config = {"from_attributes": True}


class JobResponse(BaseModel):
    id: uuid.UUID
    queue_id: uuid.UUID
    job_type: str
    payload: dict
    priority: int
    status: str
    attempts_made: int
    max_attempts: int
    run_at: datetime
    cron_expression: str | None
    claimed_by_worker_id: str | None
    claimed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobDetailResponse(JobResponse):
    """Full job detail including run history and logs."""

    runs: list[JobRunResponse] = []
    logs: list[JobLogResponse] = []


# ── Dead-letter queue ─────────────────────────────────────────────────────────

class DLQEntryResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    queue_id: uuid.UUID
    failure_reason: str | None
    total_attempts: int
    promoted_at: datetime
    retried_at: datetime | None
    retried_by_user_id: uuid.UUID | None
    retry_job_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class JobRetryResponse(BaseModel):
    """Returned when a DLQ entry is retried manually."""

    original_job_id: uuid.UUID
    new_job_id: uuid.UUID
    message: str = "Job re-queued successfully."


class JobCancelResponse(BaseModel):
    job_id: uuid.UUID
    message: str = "Job cancelled."
