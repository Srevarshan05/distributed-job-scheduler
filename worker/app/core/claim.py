"""
worker/app/core/claim.py

Atomic job claim using FOR UPDATE SKIP LOCKED.

This is the most concurrency-sensitive code in the entire system.
Read the implementation notes carefully before modifying anything here.

Why FOR UPDATE SKIP LOCKED and not a separate lock table or a message broker:
- It gives us exactly-once claim semantics within the database transaction
  without any external dependency.
- SKIP LOCKED means a worker that can't get the lock immediately moves on
  to the next eligible job rather than blocking — so 200 workers polling
  the same queue don't pile up behind a single lock.
- A separate lock table would require two round-trips and a compensating
  delete; a message broker would add an operational dependency.
- See docs/design_decisions.md for the full trade-off analysis.
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("worker.claim")

# The claim query as a named constant so it appears in exactly one place.
# Changing this query changes the system's fundamental concurrency guarantee —
# test thoroughly before touching it.
_CLAIM_QUERY = text("""
    UPDATE jobs
    SET
        status            = 'claimed',
        claimed_by_worker_id = :worker_id,
        claimed_at        = NOW()
    WHERE id = (
        SELECT id
        FROM   jobs
        WHERE  queue_id = :queue_id
          AND  status   IN ('queued', 'scheduled')
          AND  run_at  <= NOW()
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING
        id, queue_id, job_type, payload, priority, status,
        attempts_made, max_attempts, run_at, cron_expression,
        claimed_by_worker_id, claimed_at, created_at
""")


async def claim_next_job(
    db: AsyncSession,
    queue_id: uuid.UUID,
    worker_id: str,
) -> dict | None:
    """Atomically claim the next eligible job from `queue_id` for `worker_id`.

    Returns the claimed job row as a dict, or None if no eligible job exists.

    Concurrent safety: the UPDATE...WHERE id=(SELECT...FOR UPDATE SKIP LOCKED)
    pattern guarantees that exactly one worker claims each job, even under
    heavy concurrent load. This has been verified by the concurrency proof
    in tests/test_atomic_claim.py.
    """
    result = await db.execute(
        _CLAIM_QUERY,
        {"queue_id": str(queue_id), "worker_id": worker_id},
    )
    row = result.mappings().first()
    if row is None:
        return None

    logger.info(
        "worker=%s claimed job_id=%s type=%s queue=%s",
        worker_id,
        row["id"],
        row["job_type"],
        queue_id,
    )
    return dict(row)
