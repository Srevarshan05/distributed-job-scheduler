"""
backend/alembic/versions/0004_idempotency_key.py

Phase 13 schema addition:
- jobs.idempotency_key  VARCHAR(255)  NULLABLE, UNIQUE per queue
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("idempotency_key", sa.String(255), nullable=True),
    )
    # Partial unique index: one idempotency_key per queue (nulls are excluded automatically)
    op.create_index(
        "uq_jobs_queue_idempotency_key",
        "jobs",
        ["queue_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_jobs_queue_idempotency_key", table_name="jobs")
    op.drop_column("jobs", "idempotency_key")
