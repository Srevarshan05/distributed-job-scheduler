"""
backend/app/models/jobs.py

ORM models for `jobs`, `job_runs`, and `job_logs`.

Design notes:
- A single `jobs` row tracks the logical job across all its attempts.
- Each execution attempt writes one `job_runs` row — full history is preserved.
- `job_logs` stores per-run structured log lines so dashboards can replay
  exactly what happened without needing application logs.
- The two partial indexes on `jobs` are what make the system scale:
  - Poll index: (queue_id, status, priority DESC, run_at ASC) WHERE status IN ('queued','scheduled')
  - Orphan index: (claimed_by_worker_id, status) WHERE status = 'running'
  Both indexes are defined in the Alembic migration, not here, because
  SQLAlchemy's `Index()` with `postgresql_where` requires the migration to
  render the correct DDL.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# ── Status constants ──────────────────────────────────────────────────────────
# Named here so the worker and API server both import from one place —
# no magic strings scattered across the codebase.
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_SCHEDULED = "scheduled"
JOB_STATUS_CLAIMED = "claimed"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_DEAD = "dead"
JOB_STATUS_CANCELLED = "cancelled"

RUN_STATUS_STARTED = "started"
RUN_STATUS_COMPLETED = "completed"
RUN_STATUS_FAILED = "failed"


class Job(Base):
    """A unit of work in a queue.

    Lifecycle: queued/scheduled → claimed → running → completed|failed|dead|cancelled
    - `attempts_made` increments on each execution; when it reaches the queue's
      `retry_limit`, the job transitions to 'dead' and a DLQ row is created.
    - `cron_expression` is set for recurring jobs. On completion, the worker
      calculates the next `run_at` and inserts a fresh Job row — this row is
      never reused so each run has its own complete history.
    - `payload` is free-form JSONB — the handler receives it as a dict.
    """

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    queue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queues.id", ondelete="CASCADE"), nullable=False
    )
    job_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default=JOB_STATUS_QUEUED, index=True
    )
    attempts_made: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Scheduling
    run_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cron_expression: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Claim tracking
    claimed_by_worker_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Audit
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    queue: Mapped["Queue"] = relationship("Queue", back_populates="jobs")  # noqa: F821
    runs: Mapped[list["JobRun"]] = relationship(
        "JobRun", back_populates="job", cascade="all, delete-orphan"
    )
    logs: Mapped[list["JobLog"]] = relationship(
        "JobLog", back_populates="job", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Job id={self.id} type={self.job_type} status={self.status}>"


class JobRun(Base):
    """Records one execution attempt for a job.

    A new row is inserted when a worker starts running a job and updated
    when the attempt concludes (success or failure). Never deleted — this
    is the audit trail for everything that happened to a job.
    """

    __tablename__ = "job_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    worker_id: Mapped[str] = mapped_column(String(255), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)  # started|completed|failed
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    job: Mapped[Job] = relationship("Job", back_populates="runs")

    def __repr__(self) -> str:
        return (
            f"<JobRun id={self.id} job={self.job_id} attempt={self.attempt_number} "
            f"status={self.status}>"
        )


class JobLog(Base):
    """A single structured log line emitted during a job run.

    Handlers call a logging helper that writes rows here — dashboards can
    replay the log stream without needing access to server log files.
    """

    __tablename__ = "job_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_runs.id", ondelete="SET NULL"), nullable=True
    )
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    job: Mapped[Job] = relationship("Job", back_populates="logs")

    def __repr__(self) -> str:
        return f"<JobLog job={self.job_id} level={self.level}>"
