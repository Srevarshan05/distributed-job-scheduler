"""
backend/app/routers/workers.py

Worker listing endpoint with latest heartbeat resource stats.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.users import User
from app.models.workers import Worker, WorkerHeartbeat
from app.schemas.pagination import PaginatedResponse
from app.schemas.workers import WorkerDetailResponse, WorkerHeartbeatLatest

router = APIRouter(prefix="/workers", tags=["workers"])

# Threshold for "online": last_seen_at must be within this window.
# Uses the same 90-second default as orphan recovery so the two definitions
# are consistent — a worker is online if orphan recovery wouldn't touch it.
_ONLINE_THRESHOLD_SECONDS = 90


@router.get("", response_model=PaginatedResponse[WorkerDetailResponse])
async def list_workers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """List all registered worker processes with their latest resource stats."""
    result = await db.execute(
        select(Worker).order_by(Worker.last_seen_at.desc())
    )
    workers = result.scalars().all()

    items: list[WorkerDetailResponse] = []
    for w in workers:
        # Load the single most-recent heartbeat for this worker
        hb_result = await db.execute(
            select(WorkerHeartbeat)
            .where(WorkerHeartbeat.worker_id == w.worker_id)
            .order_by(WorkerHeartbeat.pinged_at.desc())
            .limit(1)
        )
        hb = hb_result.scalar_one_or_none()
        latest = (
            WorkerHeartbeatLatest(
                cpu_percent=hb.cpu_percent,
                memory_mb=hb.memory_mb,
                pinged_at=hb.pinged_at,
            )
            if hb is not None
            else None
        )

        items.append(
            WorkerDetailResponse(
                id=w.id,
                worker_id=w.worker_id,
                hostname=w.hostname,
                worker_type=w.worker_type,
                status=w.status,
                started_at=w.started_at,
                last_seen_at=w.last_seen_at,
                stopped_at=w.stopped_at,
                latest_heartbeat=latest,
            )
        )

    return {
        "items": items,
        "total": len(items),
        "page": 1,
        "page_size": max(1, len(items)),
        "pages": 1,
    }
