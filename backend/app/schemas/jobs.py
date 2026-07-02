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
    run_id: uuid.UUID | None
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
    """Full job detail including enriched context, run history, and logs.

    Phase 9.3 additions:
    - queue_name: human-readable name of the queue (avoids a separate fetch)
    - queue_position: live rank among queued jobs — 0 means next to run,
      None means the job is not in a queued/scheduled state
    - claimed_worker_hostname: hostname of the worker that claimed this job
    - created_by_email: email address of the submitting user
    - runs / logs: full attempt history and structured log stream
    - ai_failure_summary: optional AI-generated summary of failure
    """
    queue_name: str | None = None
    queue_position: int | None = None
    claimed_worker_hostname: str | None = None
    created_by_email: str | None = None
    runs: list[JobRunResponse] = []
    logs: list[JobLogResponse] = []
    ai_failure_summary: str | None = None


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
    job_type: str | None = None
    ai_failure_summary: str | None = None
    ai_summary_generated_at: datetime | None = None

    model_config = {"from_attributes": True}


class JobRetryResponse(BaseModel):
    """Returned when a DLQ entry is retried manually."""

    original_job_id: uuid.UUID
    new_job_id: uuid.UUID
    message: str = "Job re-queued successfully."


class JobCancelResponse(BaseModel):
    job_id: uuid.UUID
    message: str = "Job cancelled."
