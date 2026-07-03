"""
backend/app/routers/health.py

System health endpoint: real-time worker and queue status.

GET /health/system returns:
- workers: list of all workers with online/offline status, latest cpu%/memory
  from their most recent heartbeat row
- queues: per-queue job depth (queued + running counts)
- totals: jobs currently running, workers online vs offline

Online threshold: last_seen_at within orphan_timeout seconds of NOW().
This deliberately matches the orphan recovery threshold so the two views
of "is this worker alive" are always consistent.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.users import User

router = APIRouter(prefix="/health", tags=["health"])

# Must match orphan_recovery_loop timeout in worker (default 90s)
_ONLINE_THRESHOLD_SECONDS = 90


class WorkerHealthInfo(BaseModel):
    worker_id: str
    hostname: str | None
    worker_type: str
    online: bool
    last_seen_at: datetime
    cpu_percent: float | None
    memory_mb: float | None
    current_job_id: str | None


class QueueHealthInfo(BaseModel):
    queue_id: str
    queue_name: str
    scheduling_policy: str
    required_worker_type: str
    queued_count: int
    running_count: int


class SystemHealthResponse(BaseModel):
    checked_at: datetime
    workers_online: int
    workers_offline: int
    total_running_jobs: int
    workers: list[WorkerHealthInfo]
    queues: list[QueueHealthInfo]


@router.get("/system", response_model=SystemHealthResponse)
async def system_health(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SystemHealthResponse:
    """Return live system health: worker status + queue depths.

    cpu_percent and memory_mb come from the most recent worker_heartbeats row —
    real values written by psutil, never invented. If no heartbeat exists yet
    for a worker they are None.
    """
    now = datetime.now(timezone.utc)
    online_cutoff = now - timedelta(seconds=_ONLINE_THRESHOLD_SECONDS)

    # ── Workers with their latest heartbeat metrics ────────────────────────
    worker_result = await db.execute(
        text("""
            SELECT
                w.worker_id,
                w.hostname,
                w.worker_type,
                w.last_seen_at,
                h.cpu_percent,
                h.memory_mb
            FROM workers w
            LEFT JOIN LATERAL (
                SELECT cpu_percent, memory_mb
                FROM worker_heartbeats
                WHERE worker_id = w.worker_id
                ORDER BY pinged_at DESC
                LIMIT 1
            ) h ON TRUE
            ORDER BY w.last_seen_at DESC
        """)
    )
    worker_rows = worker_result.mappings().all()

    # ── Currently running jobs per worker ─────────────────────────────────
    running_result = await db.execute(
        text("""
            SELECT claimed_by_worker_id, id
            FROM jobs WHERE status = 'running'
        """)
    )
    running_by_worker: dict[str, str] = {}
    for row in running_result.mappings().all():
        running_by_worker[row["claimed_by_worker_id"]] = str(row["id"])

    workers: list[WorkerHealthInfo] = []
    for row in worker_rows:
        last_seen = row["last_seen_at"]
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        online = last_seen >= online_cutoff
        workers.append(
            WorkerHealthInfo(
                worker_id=row["worker_id"],
                hostname=row["hostname"],
                worker_type=row["worker_type"],
                online=online,
                last_seen_at=last_seen,
                cpu_percent=row["cpu_percent"],
                memory_mb=row["memory_mb"],
                current_job_id=running_by_worker.get(row["worker_id"]),
            )
        )

    # ── Queue depths ──────────────────────────────────────────────────────
    queue_result = await db.execute(
        text("""
            SELECT
                q.id,
                q.name,
                q.scheduling_policy,
                q.required_worker_type,
                COUNT(j.id) FILTER (WHERE j.status IN ('queued', 'scheduled')) AS queued_count,
                COUNT(j.id) FILTER (WHERE j.status = 'running') AS running_count
            FROM queues q
            LEFT JOIN jobs j ON j.queue_id = q.id
            WHERE q.is_active = TRUE
            GROUP BY q.id, q.name, q.scheduling_policy, q.required_worker_type
            ORDER BY q.name
        """)
    )
    queues: list[QueueHealthInfo] = [
        QueueHealthInfo(
            queue_id=str(row["id"]),
            queue_name=row["name"],
            scheduling_policy=row["scheduling_policy"],
            required_worker_type=row["required_worker_type"],
            queued_count=row["queued_count"] or 0,
            running_count=row["running_count"] or 0,
        )
        for row in queue_result.mappings().all()
    ]

    online_count = sum(1 for w in workers if w.online)
    total_running = sum(q.running_count for q in queues)

    return SystemHealthResponse(
        checked_at=now,
        workers_online=online_count,
        workers_offline=len(workers) - online_count,
        total_running_jobs=total_running,
        workers=workers,
        queues=queues,
    )


# ── Throughput Visualization ──────────────────────────────────────────────────

class ThroughputPoint(BaseModel):
    timestamp: str  # e.g., "10:15", "10:20"
    completed_count: int


class ThroughputResponse(BaseModel):
    points: list[ThroughputPoint]


@router.get("/throughput", response_model=ThroughputResponse)
async def system_throughput(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ThroughputResponse:
    """Return historical job completion counts bucketed in 5-minute windows for the last hour.

    Provides real-time data for the dashboard line chart to visualize throughput.
    """
    now = datetime.now(timezone.utc)
    buckets = []
    for i in range(12):
        start = now - timedelta(minutes=(12 - i) * 5)
        # Round down to nearest 5 mins
        start = start.replace(minute=(start.minute // 5) * 5, second=0, microsecond=0)
        end = start + timedelta(minutes=5)
        buckets.append((start, end))

    points = []
    for start, end in buckets:
        res = await db.execute(
            text(
                "SELECT COUNT(*) FROM jobs "
                "WHERE status = 'completed' AND updated_at >= :start AND updated_at < :end"
            ),
            {"start": start, "end": end}
        )
        count = res.scalar_one() or 0
        label = start.strftime("%H:%M")
        points.append(ThroughputPoint(timestamp=label, completed_count=count))

    return ThroughputResponse(points=points)

