"""
worker/app/core/executor.py

Job execution, retry scheduling, and DLQ promotion.

Each call to `execute_job` runs one attempt of one job. It:
1. Transitions the job to 'running' and writes a JobRun row.
2. Calls the registered handler.
3. On success: marks completed (or schedules next cron run).
4. On failure: either re-queues with backoff or promotes to DLQ.

All state transitions happen inside a single session — if the DB write
fails, the job stays in 'claimed' and the orphan recovery will re-queue it.
"""
import logging
import time
import uuid
import json
from datetime import datetime, timedelta, timezone

from croniter import croniter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import broadcast
from app.core.retry import calculate_next_run_delay
from app.handlers import get_handler

logger = logging.getLogger("worker.executor")

# Import model constants here to avoid circular imports with the backend package.
# The worker has its own copy of these string values — they must stay in sync
# with backend/app/models/jobs.py. Both are tested against the same DB.
JOB_STATUS_RUNNING = "running"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_DEAD = "dead"

RUN_STATUS_STARTED = "started"
RUN_STATUS_COMPLETED = "completed"
RUN_STATUS_FAILED = "failed"


async def execute_job(
    db: AsyncSession, job: dict, worker_id: str,
    worker_type: str = "standard", scheduling_policy: str = "priority"
) -> None:
    """Run one execution attempt of `job` on behalf of `worker_id`.

    `job` is the raw dict returned by `claim_next_job`. The function is
    intentionally decoupled from the ORM — it uses raw SQL via the session
    to avoid loading the full model graph on every execution.

    `worker_type` and `scheduling_policy` are recorded in job_logs at claim
    time so the scheduling decision is visible in the job's log stream.
    """
    job_id: str = str(job["id"])
    job_type: str = job["job_type"]
    payload: dict = job["payload"] if isinstance(job["payload"], dict) else {}
    attempts_made: int = job["attempts_made"] + 1
    max_attempts: int = job["max_attempts"]
    queue_id: str = str(job["queue_id"])
    cron_expression: str | None = job.get("cron_expression")

    # ── Transition to 'running', write the JobRun row ──────────────────────
    await db.execute(
        text("UPDATE jobs SET status='running', attempts_made=:att WHERE id=:jid"),
        {"att": attempts_made, "jid": job_id},
    )

    run_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO job_runs (id, job_id, worker_id, attempt_number, status, started_at)
            VALUES (:id, :job_id, :worker_id, :attempt, :status, NOW())
        """),
        {
            "id": run_id,
            "job_id": job_id,
            "worker_id": worker_id,
            "attempt": attempts_made,
            "status": RUN_STATUS_STARTED,
        },
    )
    await db.commit()

    # ── Log the claim/scheduling decision ─────────────────────────────────
    # Written after commit so the log row is visible even if execution fails.
    try:
        async with __import__("app.core.database", fromlist=["get_db_session"]).get_db_session() as log_db:
            log_id = str(uuid.uuid4())
            await log_db.execute(
                text(
                    "INSERT INTO job_logs (id, job_id, run_id, level, message, logged_at) "
                    "VALUES (:id, :job_id, :run_id, 'info', :msg, NOW())"
                ),
                {
                    "id": log_id,
                    "job_id": job_id,
                    "run_id": run_id,
                    "msg": (
                        f"Claimed under '{scheduling_policy}' policy by "
                        f"worker '{worker_id}' (type: {worker_type}), "
                        f"attempt {attempts_made}/{max_attempts}"
                    ),
                },
            )
    except Exception:
        logger.warning("job_id=%s Could not write claim log entry.", job_id)

    await broadcast("job_status_changed", {"job_id": job_id, "status": JOB_STATUS_RUNNING})

    # ── Execute the handler ────────────────────────────────────────────────
    handler = get_handler(job_type)
    start_ms = time.monotonic()
    error_message: str | None = None
    success = False

    if handler is None:
        error_message = f"No handler registered for job_type='{job_type}'."
        logger.error("job_id=%s %s", job_id, error_message)
    else:
        try:
            await handler(payload, job_id)
            success = True
        except Exception as exc:
            error_message = str(exc)
            logger.warning("job_id=%s attempt=%d failed: %s", job_id, attempts_made, error_message)

    duration_ms = int((time.monotonic() - start_ms) * 1000)
    run_status = RUN_STATUS_COMPLETED if success else RUN_STATUS_FAILED

    # ── Update the JobRun row ──────────────────────────────────────────────
    await db.execute(
        text("""
            UPDATE job_runs
            SET status=:status, finished_at=NOW(), duration_ms=:dur, error_message=:err
            WHERE id=:run_id
        """),
        {"status": run_status, "dur": duration_ms, "err": error_message, "run_id": run_id},
    )

    if success:
        await _handle_success(db, job_id, queue_id, cron_expression)
    else:
        await _handle_failure(db, job_id, queue_id, attempts_made, max_attempts, error_message, job)

    await db.commit()


async def _handle_success(
    db: AsyncSession,
    job_id: str,
    queue_id: str,
    cron_expression: str | None,
) -> None:
    """Mark the job completed and, for recurring jobs, schedule the next run."""
    await db.execute(
        text("UPDATE jobs SET status='completed' WHERE id=:jid"),
        {"jid": job_id},
    )
    await broadcast("job_status_changed", {"job_id": job_id, "status": JOB_STATUS_COMPLETED})
    logger.info("job_id=%s completed.", job_id)

    if cron_expression:
        await _schedule_next_cron_run(db, job_id, queue_id, cron_expression)


async def _schedule_next_cron_run(
    db: AsyncSession,
    parent_job_id: str,
    queue_id: str,
    cron_expression: str,
) -> None:
    """Calculate the next run time and insert a fresh job row.

    Each cron run is a new row — the old row is never mutated — so every
    execution has its own complete history in job_runs and job_logs.
    """
    # Load original job config to copy into the new row
    result = await db.execute(
        text("SELECT job_type, payload, priority, max_attempts FROM jobs WHERE id=:jid"),
        {"jid": parent_job_id},
    )
    row = result.mappings().first()
    if row is None:
        logger.error("Cannot schedule next cron run: job_id=%s not found.", parent_job_id)
        return

    try:
        cron = croniter(cron_expression, datetime.now(timezone.utc))
        next_run: datetime = cron.get_next(datetime)
    except Exception as exc:
        logger.error("Invalid cron expression '%s': %s", cron_expression, exc)
        return

    new_id = str(uuid.uuid4())
    payload = row["payload"]
    if not isinstance(payload, str):
        payload = json.dumps(payload)

    await db.execute(
        text("""
            INSERT INTO jobs
                (id, queue_id, job_type, payload, priority, status, max_attempts,
                 run_at, cron_expression, created_at, updated_at)
            VALUES
                (:id, :qid, :jtype, :payload, :priority, 'scheduled', :max_att,
                 :run_at, :cron, NOW(), NOW())
        """),
        {
            "id": new_id,
            "qid": queue_id,
            "jtype": row["job_type"],
            "payload": payload,
            "priority": row["priority"],
            "max_att": row["max_attempts"],
            "run_at": next_run,
            "cron": cron_expression,
        },
    )
    logger.info("Cron job=%s → scheduled next run job=%s at %s", parent_job_id, new_id, next_run)


async def _handle_failure(
    db: AsyncSession,
    job_id: str,
    queue_id: str,
    attempts_made: int,
    max_attempts: int,
    error_message: str | None,
    job: dict,
) -> None:
    """Re-queue with backoff or promote to DLQ when attempts are exhausted."""
    if attempts_made < max_attempts:
        # Load queue retry config
        result = await db.execute(
            text("SELECT retry_strategy, retry_delay_seconds FROM queues WHERE id=:qid"),
            {"qid": queue_id},
        )
        queue_row = result.mappings().first()
        strategy = queue_row["retry_strategy"] if queue_row else "exponential"
        base_delay = queue_row["retry_delay_seconds"] if queue_row else 60

        delay_seconds = calculate_next_run_delay(strategy, base_delay, attempts_made)
        next_run = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)

        await db.execute(
            text("UPDATE jobs SET status='queued', run_at=:run_at WHERE id=:jid"),
            {"run_at": next_run, "jid": job_id},
        )
        await broadcast("job_status_changed", {"job_id": job_id, "status": JOB_STATUS_QUEUED})
        logger.info(
            "job_id=%s re-queued for attempt %d/%d in %ds.",
            job_id, attempts_made + 1, max_attempts, delay_seconds,
        )
    else:
        # Attempts exhausted — promote to DLQ
        await db.execute(
            text("UPDATE jobs SET status='dead' WHERE id=:jid"),
            {"jid": job_id},
        )
        dlq_id = str(uuid.uuid4())
        await db.execute(
            text("""
                INSERT INTO dead_letter_queue
                    (id, job_id, queue_id, failure_reason, total_attempts, promoted_at)
                VALUES
                    (:id, :job_id, :queue_id, :reason, :attempts, NOW())
            """),
            {
                "id": dlq_id,
                "job_id": job_id,
                "queue_id": queue_id,
                "reason": error_message,
                "attempts": attempts_made,
            },
        )
        await broadcast("job_status_changed", {"job_id": job_id, "status": JOB_STATUS_DEAD})
        logger.warning("job_id=%s exhausted %d attempts → DLQ.", job_id, attempts_made)

        # Trigger AI summary generation asynchronously (Phase 10.5)
        import asyncio
        from app.ai_summary import generate_and_save_ai_summary
        asyncio.create_task(generate_and_save_ai_summary(job_id, queue_id))
