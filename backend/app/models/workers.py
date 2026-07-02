"""
backend/app/models/workers.py

ORM models for `workers` and `worker_heartbeats`.

Design note: each worker process registers itself in `workers` on startup
and sends a heartbeat every HEARTBEAT_INTERVAL_SECONDS. The orphan recovery
task (running independently) checks `last_seen_at` against NOW() and
re-queues jobs owned by workers whose heartbeat is more than
ORPHAN_TIMEOUT_SECONDS old (3× the heartbeat interval by design —
see docs/design_decisions.md for the rationale).
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# Worker lifecycle states
WORKER_STATUS_ACTIVE = "active"
WORKER_STATUS_IDLE = "idle"
WORKER_STATUS_STOPPED = "stopped"


class Worker(Base):
    """A running worker process instance.

    `worker_id` is set by the worker process on startup (from WORKER_ID env var
    or auto-generated). Multiple processes can run concurrently — each gets
    its own row.
    """

    __tablename__ = "workers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    worker_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default=WORKER_STATUS_IDLE
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    heartbeats: Mapped[list["WorkerHeartbeat"]] = relationship(
        "WorkerHeartbeat", back_populates="worker", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Worker id={self.worker_id} status={self.status}>"


class WorkerHeartbeat(Base):
    """One heartbeat ping from a worker process.

    Rows are inserted (never updated) — they form an append-only log of
    every heartbeat so we can see gaps in the timeline if something went wrong.
    """

    __tablename__ = "worker_heartbeats"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    worker_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True
    )
    pinged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    worker: Mapped[Worker] = relationship("Worker", back_populates="heartbeats")

    def __repr__(self) -> str:
        return f"<WorkerHeartbeat worker={self.worker_id} at={self.pinged_at}>"
