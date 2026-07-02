"""
backend/app/models/dlq.py

ORM model for the `dead_letter_queue` table.

A row is inserted here when a job exhausts all its retry attempts.
The original `jobs` row is left intact (status = 'dead') for full traceability.
Manual retry via the API creates a fresh `jobs` row with `attempts_made = 0`
and records who triggered the retry in `retried_by_user_id`.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class DeadLetterEntry(Base):
    """A job that has exhausted all retry attempts.

    `failure_reason` captures the last exception message so operators can
    diagnose failures without digging through application logs.
    `total_attempts` is recorded at promotion time for quick reference.
    """

    __tablename__ = "dead_letter_queue"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,   # one DLQ entry per dead job
        index=True,
    )
    queue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_attempts: Mapped[int] = mapped_column(Integer, nullable=False)
    promoted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Retry tracking — set when an operator retries the job through the API
    retried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retried_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    retry_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )  # the new job row created on retry

    job: Mapped["Job"] = relationship("Job")  # noqa: F821

    def __repr__(self) -> str:
        return f"<DeadLetterEntry job={self.job_id} attempts={self.total_attempts}>"
