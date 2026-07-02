"""
backend/app/models/projects.py

ORM models for `projects` and `queues`.

Projects group queues inside an organization. Queues hold the actual job
backlog and carry per-queue configuration for retry policy, concurrency,
and pause state. Slug uniqueness is scoped to the parent (org for projects,
project for queues) — two orgs may share a project slug without conflict.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Project(Base):
    """A logical grouping of queues within one organization.

    Soft-deleted via `is_active = False`.
    Unique constraint: (org_id, slug) — two orgs can share a slug.
    """

    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("org_id", "slug", name="uq_project_org_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    organization: Mapped["Organization"] = relationship(  # noqa: F821
        "Organization", back_populates="projects"
    )
    queues: Mapped[list["Queue"]] = relationship(
        "Queue", back_populates="project", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Project id={self.id} slug={self.slug}>"


class Queue(Base):
    """A FIFO-priority job backlog within a project.

    Key configuration fields:
    - `max_workers`: maximum concurrent workers allowed to pull from this queue.
    - `retry_limit`: how many times a failed job is retried before going to DLQ.
    - `retry_strategy`: 'fixed' | 'linear' | 'exponential'.
    - `retry_delay_seconds`: base delay between retries.
    - `is_paused`: when True, workers skip this queue on poll. Running jobs
      are NOT cancelled — pause only blocks NEW claims. This rule is also
      enforced in the worker's polling logic.
    - `is_active`: soft-delete flag.

    Unique constraint: (project_id, slug).
    """

    __tablename__ = "queues"
    __table_args__ = (UniqueConstraint("project_id", "slug", name="uq_queue_project_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # ── Concurrency ──────────────────────────────────────────────────────────
    max_workers: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # ── Retry policy ─────────────────────────────────────────────────────────
    retry_limit: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    retry_strategy: Mapped[str] = mapped_column(
        String(50), default="exponential", nullable=False
    )  # 'fixed' | 'linear' | 'exponential'
    retry_delay_seconds: Mapped[int] = mapped_column(Integer, default=60, nullable=False)

    # ── Worker routing (Phase 9.1) ────────────────────────────────────────────
    # Workers only claim from queues whose required_worker_type matches their own
    # worker_type. This is enforced atomically inside the claim query.
    required_worker_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="standard"
    )

    # ── Scheduling policy (Phase 9.2) ─────────────────────────────────────────
    # 'fifo'       — claim strictly by created_at ASC, ignore priority
    # 'priority'   — priority DESC, created_at ASC (default)
    # 'fair_share' — at the worker level, rotate across eligible queues so no
    #                single queue starves the others
    scheduling_policy: Mapped[str] = mapped_column(
        String(50), nullable=False, default="priority"
    )

    # ── State ────────────────────────────────────────────────────────────────
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    project: Mapped[Project] = relationship("Project", back_populates="queues")
    jobs: Mapped[list["Job"]] = relationship(  # noqa: F821
        "Job", back_populates="queue", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Queue id={self.id} slug={self.slug} paused={self.is_paused}>"
