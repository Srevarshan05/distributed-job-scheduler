"""
backend/alembic/versions/0002_phase9_schema.py

Phase 9 schema additions:
- workers.worker_type            VARCHAR(50) DEFAULT 'standard'
- queues.required_worker_type   VARCHAR(50) DEFAULT 'standard'
- queues.scheduling_policy      VARCHAR(50) DEFAULT 'priority'
- worker_heartbeats.cpu_percent FLOAT       NULLABLE
- worker_heartbeats.memory_mb   FLOAT       NULLABLE

No existing columns are removed or renamed. All new columns have safe
defaults so the migration is safe to run on a live database.
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── workers ────────────────────────────────────────────────────────────────
    op.add_column(
        "workers",
        sa.Column("worker_type", sa.String(50), nullable=False, server_default="standard"),
    )

    # ── queues ─────────────────────────────────────────────────────────────────
    op.add_column(
        "queues",
        sa.Column(
            "required_worker_type", sa.String(50), nullable=False, server_default="standard"
        ),
    )
    op.add_column(
        "queues",
        sa.Column(
            "scheduling_policy", sa.String(50), nullable=False, server_default="priority"
        ),
    )

    # ── worker_heartbeats ──────────────────────────────────────────────────────
    op.add_column(
        "worker_heartbeats",
        sa.Column("cpu_percent", sa.Float(), nullable=True),
    )
    op.add_column(
        "worker_heartbeats",
        sa.Column("memory_mb", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("worker_heartbeats", "memory_mb")
    op.drop_column("worker_heartbeats", "cpu_percent")
    op.drop_column("queues", "scheduling_policy")
    op.drop_column("queues", "required_worker_type")
    op.drop_column("workers", "worker_type")
