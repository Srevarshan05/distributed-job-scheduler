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

Phase 9.1 change: the claim query now joins `queues` inside the subquery
and filters by `q.required_worker_type = :worker_type`. This is done
atomically — the routing decision happens inside the same
SELECT...FOR UPDATE SKIP LOCKED, so there is no window where a worker
checks eligibility and then loses the race to claim.

Phase 9.2 change: the ORDER BY inside the subquery is determined by the
queue's `scheduling_policy`:
  - 'priority'  → priority DESC, created_at ASC  (original behaviour)
  - 'fifo'      → created_at ASC only
  - 'fair_share' → same per-job order as 'priority'; the fair rotation
                   across queues is handled at the poller level.
The policy is read from the queue row in the same join, not in a
separate query, so there is exactly one DB round-trip per claim attempt.
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("worker.claim")

# ── Per-policy claim queries ──────────────────────────────────────────────────
# These are named constants so modifying the claim logic is a deliberate
# change in one place, not a scattered edit across the file.

_CLAIM_QUERY_PRIORITY = text("""
    UPDATE jobs
    SET
        status            = 'claimed',
        claimed_by_worker_id = :worker_id,
        claimed_at        = NOW()
    WHERE id = (
        SELECT j.id
        FROM   jobs j
        JOIN   queues q ON q.id = j.queue_id
        WHERE  j.queue_id = :queue_id
          AND  j.status   IN ('queued', 'scheduled')
          AND  j.run_at  <= NOW()
          AND  q.required_worker_type = :worker_type
        ORDER BY j.priority DESC, j.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING
        id, queue_id, job_type, payload, priority, status,
        attempts_made, max_attempts, run_at, cron_expression,
        claimed_by_worker_id, claimed_at, created_at
""")

_CLAIM_QUERY_FIFO = text("""
    UPDATE jobs
    SET
        status            = 'claimed',
        claimed_by_worker_id = :worker_id,
        claimed_at        = NOW()
    WHERE id = (
        SELECT j.id
        FROM   jobs j
        JOIN   queues q ON q.id = j.queue_id
        WHERE  j.queue_id = :queue_id
          AND  j.status   IN ('queued', 'scheduled')
          AND  j.run_at  <= NOW()
          AND  q.required_worker_type = :worker_type
        ORDER BY j.created_at ASC
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
    worker_type: str,
    scheduling_policy: str,
) -> dict | None:
    """Atomically claim the next eligible job from `queue_id` for `worker_id`.

    Returns the claimed job row as a dict, or None if no eligible job exists.

    `worker_type` filters by `queues.required_worker_type` inside the
    subquery — the routing decision is part of the atomic claim, not a
    pre-check that could be invalidated by a race.

    `scheduling_policy` selects the ORDER BY strategy:
    - 'priority'  / 'fair_share' → priority DESC, created_at ASC
    - 'fifo'                     → created_at ASC only
    """
    if scheduling_policy == "fifo":
        query = _CLAIM_QUERY_FIFO
    else:
        # 'priority' and 'fair_share' both use priority ordering per-job;
        # fair_share's rotation across queues is handled in poller.py
        query = _CLAIM_QUERY_PRIORITY

    result = await db.execute(
        query,
        {"queue_id": str(queue_id), "worker_id": worker_id, "worker_type": worker_type},
    )
    row = result.mappings().first()
    if row is None:
        return None

    logger.info(
        "worker=%s (type=%s) claimed job_id=%s type=%s queue=%s policy=%s",
        worker_id,
        worker_type,
        row["id"],
        row["job_type"],
        queue_id,
        scheduling_policy,
    )
    return dict(row)
