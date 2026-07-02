"""
worker/app/core/poller.py

The main polling loop, heartbeat sender, and orphan recovery task.
These three run as concurrent asyncio tasks inside the worker process.

Shutdown contract:
- A `stop_event` (asyncio.Event) is set on SIGTERM/SIGINT.
- Each loop checks the event before starting any new work.
- The executor finishes the job it's currently running before the process exits.
"""
import asyncio
import logging
import os
import socket
from datetime import datetime, timezone

from sqlalchemy import text

from app.core.claim import claim_next_job
from app.core.config import get_worker_settings
from app.core.database import get_db_session
from app.core.events import broadcast
from app.core.executor import execute_job

logger = logging.getLogger("worker.poller")

# Global stop signal — set by the signal handler in main.py
_stop_event: asyncio.Event | None = None


def set_stop_event(event: asyncio.Event) -> None:
    """Register the stop event. Called once on worker startup."""
    global _stop_event
    _stop_event = event


def _is_stopping() -> bool:
    return _stop_event is not None and _stop_event.is_set()


async def _register_worker(worker_id: str) -> None:
    """Insert or update the worker row in the `workers` table on startup."""
    async with get_db_session() as db:
        await db.execute(
            text("""
                INSERT INTO workers (id, worker_id, hostname, status, started_at, last_seen_at)
                VALUES (gen_random_uuid(), :wid, :host, 'active', NOW(), NOW())
                ON CONFLICT (worker_id) DO UPDATE
                    SET status='active', started_at=NOW(), last_seen_at=NOW()
            """),
            {"wid": worker_id, "host": socket.gethostname()},
        )
    logger.info("Worker '%s' registered.", worker_id)


async def _mark_worker_stopped(worker_id: str) -> None:
    """Set the worker's status to 'stopped' on clean shutdown."""
    async with get_db_session() as db:
        await db.execute(
            text(
                "UPDATE workers SET status='stopped', stopped_at=NOW() WHERE worker_id=:wid"
            ),
            {"wid": worker_id},
        )
    logger.info("Worker '%s' marked stopped.", worker_id)


async def heartbeat_loop(worker_id: str) -> None:
    """Send a heartbeat every HEARTBEAT_INTERVAL_SECONDS.

    Each heartbeat updates `workers.last_seen_at` AND inserts a row into
    `worker_heartbeats` (append-only log) so any gaps are visible in the DB.
    """
    settings = get_worker_settings()
    interval = settings.heartbeat_interval_seconds

    while not _is_stopping():
        try:
            async with get_db_session() as db:
                await db.execute(
                    text("UPDATE workers SET last_seen_at=NOW(), status='active' WHERE worker_id=:wid"),
                    {"wid": worker_id},
                )
                await db.execute(
                    text(
                        "INSERT INTO worker_heartbeats (id, worker_id, pinged_at) "
                        "VALUES (gen_random_uuid(), :wid, NOW())"
                    ),
                    {"wid": worker_id},
                )
            await broadcast("worker_heartbeat", {"worker_id": worker_id})
        except Exception:
            logger.exception("Heartbeat failed for worker '%s'.", worker_id)

        await asyncio.sleep(interval)


async def orphan_recovery_loop() -> None:
    """Re-queue jobs whose owning worker has missed its heartbeat deadline.

    Runs independently of any specific worker — all running worker processes
    compete to run this check, but the UPDATE...WHERE is idempotent so
    double-runs are safe.

    Why the 3× multiplier (orphan_timeout = 3 × heartbeat_interval):
    A single missed heartbeat (e.g. from a brief DB hiccup) should not
    re-queue a live job. Three missed heartbeats means the worker is almost
    certainly dead. See docs/design_decisions.md for the full reasoning.
    """
    settings = get_worker_settings()
    check_interval = settings.heartbeat_interval_seconds
    timeout = settings.orphan_timeout_seconds

    while not _is_stopping():
        try:
            async with get_db_session() as db:
                result = await db.execute(
                    text("""
                        UPDATE jobs
                        SET
                            status               = 'queued',
                            claimed_by_worker_id = NULL,
                            claimed_at           = NULL
                        WHERE
                            status = 'running'
                            AND claimed_by_worker_id IN (
                                SELECT worker_id FROM workers
                                WHERE last_seen_at < NOW() - INTERVAL ':timeout seconds'
                            )
                        RETURNING id, claimed_by_worker_id
                    """).bindparams(timeout=timeout)
                )
                rows = result.mappings().all()

            for row in rows:
                logger.warning(
                    "Orphan recovery: re-queued job_id=%s (worker=%s timed out).",
                    row["id"],
                    row["claimed_by_worker_id"],
                )
                await broadcast(
                    "job_status_changed",
                    {"job_id": str(row["id"]), "status": "queued", "reason": "orphan_recovery"},
                )
        except Exception:
            logger.exception("Orphan recovery loop error.")

        await asyncio.sleep(check_interval)


async def polling_loop(worker_id: str) -> None:
    """Main polling loop.

    On each tick, load all active non-paused queues and try to claim one job
    from each. Claimed jobs are executed in asyncio background tasks so the
    loop never blocks waiting for a job to finish.

    Pausing a queue stops NEW claims — this check is the enforcement point.
    Running jobs are left alone (the pause flag is only checked here, not
    in the executor).
    """
    settings = get_worker_settings()
    interval = settings.poll_interval_seconds

    while not _is_stopping():
        try:
            async with get_db_session() as db:
                result = await db.execute(
                    text(
                        "SELECT id FROM queues WHERE is_active=TRUE AND is_paused=FALSE"
                    )
                )
                queue_ids = [row[0] for row in result.fetchall()]

            for queue_id in queue_ids:
                if _is_stopping():
                    break
                async with get_db_session() as db:
                    job = await claim_next_job(db, queue_id, worker_id)
                if job:
                    asyncio.create_task(
                        _run_job_safely(job, worker_id),
                        name=f"job-{job['id']}",
                    )
        except Exception:
            logger.exception("Polling loop error.")

        await asyncio.sleep(interval)


async def _run_job_safely(job: dict, worker_id: str) -> None:
    """Wrap execute_job to catch and log any unhandled exceptions.

    The executor handles all expected failure paths (retry, DLQ). This
    wrapper catches anything that escaped — it should never fire in
    normal operation, but if it does it must not silently disappear.
    """
    try:
        async with get_db_session() as db:
            await execute_job(db, job, worker_id)
    except Exception:
        logger.exception(
            "Unhandled exception executing job_id=%s. "
            "The job may be stuck as 'running' until orphan recovery re-queues it.",
            job.get("id"),
        )


async def run_worker(worker_id: str, stop_event: asyncio.Event) -> None:
    """Entry point: start all background tasks and wait for the stop signal.

    Graceful shutdown: when the stop event fires, the polling loop exits
    cleanly. Already-running jobs (in their own tasks) are awaited via
    `asyncio.gather` so the process doesn't exit mid-execution.
    """
    set_stop_event(stop_event)
    await _register_worker(worker_id)

    tasks = [
        asyncio.create_task(polling_loop(worker_id), name="polling-loop"),
        asyncio.create_task(heartbeat_loop(worker_id), name="heartbeat-loop"),
        asyncio.create_task(orphan_recovery_loop(), name="orphan-recovery"),
    ]

    await stop_event.wait()
    logger.info("Stop signal received. Finishing in-flight jobs...")

    # Cancel the control loops — they will exit cleanly on next iteration check
    for task in tasks:
        task.cancel()

    # Wait for any still-running job tasks to complete
    all_tasks = asyncio.all_tasks()
    job_tasks = [t for t in all_tasks if t.get_name().startswith("job-")]
    if job_tasks:
        logger.info("Waiting for %d job(s) to finish...", len(job_tasks))
        await asyncio.gather(*job_tasks, return_exceptions=True)

    await _mark_worker_stopped(worker_id)
    logger.info("Worker '%s' shut down cleanly.", worker_id)
