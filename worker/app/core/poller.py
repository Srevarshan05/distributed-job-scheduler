"""
worker/app/core/poller.py

The main polling loop, heartbeat sender, and orphan recovery task.
These three run as concurrent asyncio tasks inside the worker process.

Shutdown contract:
- A `stop_event` (asyncio.Event) is set on SIGTERM/SIGINT.
- Each loop checks the event before starting any new work.
- The executor finishes the job it's currently running before the process exits.

Phase 9.1 additions:
- Workers register their `worker_type` on startup (from WORKER_TYPE env var).
- Polling loop reads each queue's `required_worker_type` and `scheduling_policy`
  and only claims from queues whose type matches this worker's type.
- Heartbeat loop reads real CPU% and memory (MB) from psutil.Process()
  and stores them in `worker_heartbeats`. These are genuine OS-level numbers.

Phase 9.2 addition:
- fair_share scheduling: queues eligible for this worker are rotated in
  round-robin order so no single queue can starve the others. The per-job
  ORDER BY (priority vs fifo) is still applied inside the claim query.
"""
import asyncio
import logging
import os
import socket
import uuid
from collections import deque
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


def _read_cpu_and_memory() -> tuple[float | None, float | None]:
    """Return (cpu_percent, memory_mb) from the current process via psutil.

    Returns (None, None) if psutil is unavailable or the call fails.
    These are real OS-level measurements — no invented values.
    """
    try:
        import psutil  # type: ignore[import]
        proc = psutil.Process(os.getpid())
        cpu = proc.cpu_percent(interval=None)   # non-blocking; % since last call
        mem_bytes = proc.memory_info().rss
        return round(cpu, 2), round(mem_bytes / (1024 * 1024), 2)
    except Exception:
        return None, None


async def _register_worker(worker_id: str, worker_type: str) -> None:
    """Insert or update the worker row in the `workers` table on startup."""
    worker_uuid = str(uuid.uuid4())
    async with get_db_session() as db:
        await db.execute(
            text("""
                INSERT INTO workers (id, worker_id, hostname, worker_type, status, started_at, last_seen_at)
                VALUES (:id, :wid, :host, :wtype, 'active', NOW(), NOW())
                ON CONFLICT (worker_id) DO UPDATE
                    SET status='active', worker_type=:wtype, started_at=NOW(), last_seen_at=NOW()
            """),
            {
                "id": worker_uuid,
                "wid": worker_id,
                "host": socket.gethostname(),
                "wtype": worker_type,
            },
        )
    logger.info("Worker '%s' (type=%s) registered.", worker_id, worker_type)


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

    Each heartbeat:
    - Updates `workers.last_seen_at` so orphan recovery knows we're alive.
    - Inserts one row into `worker_heartbeats` (append-only log).
    - Records real cpu_percent and memory_mb from psutil.Process() — genuine
      OS measurements, not simulated values. If psutil fails they are NULL.
    - Broadcasts a `worker_heartbeat` event to connected WebSocket clients
      including the real resource numbers.
    """
    settings = get_worker_settings()
    interval = settings.heartbeat_interval_seconds

    while not _is_stopping():
        try:
            cpu, mem = _read_cpu_and_memory()
            async with get_db_session() as db:
                hb_id = str(uuid.uuid4())
                await db.execute(
                    text(
                        "UPDATE workers SET last_seen_at=NOW(), status='active' WHERE worker_id=:wid"
                    ),
                    {"wid": worker_id},
                )
                await db.execute(
                    text(
                        "INSERT INTO worker_heartbeats "
                        "(id, worker_id, pinged_at, cpu_percent, memory_mb) "
                        "VALUES (:id, :wid, NOW(), :cpu, :mem)"
                    ),
                    {"id": hb_id, "wid": worker_id, "cpu": cpu, "mem": mem},
                )
            await broadcast(
                "worker_heartbeat",
                {
                    "worker_id": worker_id,
                    "cpu_percent": cpu,
                    "memory_mb": mem,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
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
                                WHERE last_seen_at < NOW() - (:timeout * INTERVAL '1 second')
                            )
                        RETURNING id, claimed_by_worker_id
                    """),
                    {"timeout": timeout},
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


async def polling_loop(worker_id: str, worker_type: str) -> None:
    """Main polling loop with worker-type routing and scheduling-policy support.

    On each tick, load all active non-paused queues that this worker is
    eligible for (matching required_worker_type) and try to claim one job
    from each.

    fair_share: when a worker has multiple eligible queues, it processes them
    in round-robin order (via a deque) so no single busy queue can starve
    quieter ones. One job is claimed per queue per tick before moving on.
    For 'priority' and 'fifo' policies the ORDER BY inside the claim query
    determines per-queue claim order — the deque rotation is always active
    so even non-fair-share queues don't stall each other.
    """
    settings = get_worker_settings()
    interval = settings.poll_interval_seconds

    # Round-robin deque for fair_share / preventing queue starvation
    queue_rotation: deque = deque()

    while not _is_stopping():
        try:
            async with get_db_session() as db:
                result = await db.execute(
                    text(
                        "SELECT id, scheduling_policy FROM queues "
                        "WHERE is_active=TRUE AND is_paused=FALSE "
                        "  AND required_worker_type=:wtype"
                    ),
                    {"wtype": worker_type},
                )
                rows = result.fetchall()

            # Maintain deque: add new queues to the end, remove gone ones
            current_ids = {str(r[0]): r[1] for r in rows}
            known_ids = {item[0] for item in queue_rotation}

            for qid in list(known_ids):
                if qid not in current_ids:
                    queue_rotation = deque(item for item in queue_rotation if item[0] != qid)

            for qid, policy in current_ids.items():
                if qid not in known_ids:
                    queue_rotation.append((qid, policy))

            # Process each queue once per tick in rotation order
            for _ in range(len(queue_rotation)):
                if _is_stopping():
                    break
                queue_id_str, policy = queue_rotation[0]
                queue_rotation.rotate(-1)   # move this queue to the end

                import uuid as _uuid
                async with get_db_session() as db:
                    job = await claim_next_job(
                        db,
                        _uuid.UUID(queue_id_str),
                        worker_id,
                        worker_type,
                        policy,
                    )
                if job:
                    asyncio.create_task(
                        _run_job_safely(job, worker_id, worker_type, policy),
                        name=f"job-{job['id']}",
                    )

        except Exception:
            logger.exception("Polling loop error.")

        await asyncio.sleep(interval)


async def _run_job_safely(
    job: dict, worker_id: str, worker_type: str, scheduling_policy: str
) -> None:
    """Wrap execute_job to catch and log any unhandled exceptions.

    The executor handles all expected failure paths (retry, DLQ). This
    wrapper catches anything that escaped — it should never fire in
    normal operation, but if it does it must not silently disappear.
    """
    try:
        async with get_db_session() as db:
            await execute_job(db, job, worker_id, worker_type, scheduling_policy)
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
    settings = get_worker_settings()
    worker_type = settings.worker_type
    set_stop_event(stop_event)
    await _register_worker(worker_id, worker_type)

    tasks = [
        asyncio.create_task(polling_loop(worker_id, worker_type), name="polling-loop"),
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
