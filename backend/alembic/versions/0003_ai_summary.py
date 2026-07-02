"""
backend/alembic/versions/0003_ai_summary.py

Phase 10 schema additions:
- dead_letter_queue.ai_failure_summary      TEXT        NULLABLE
- dead_letter_queue.ai_summary_generated_at TIMESTAMPTZ NULLABLE
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dead_letter_queue",
        sa.Column("ai_failure_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "dead_letter_queue",
        sa.Column("ai_summary_generated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("dead_letter_queue", "ai_summary_generated_at")
    op.drop_column("dead_letter_queue", "ai_failure_summary")
