"""
backend/app/schemas/workers.py

Response schemas for worker endpoints.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel


class WorkerHeartbeatLatest(BaseModel):
    """Latest resource metrics from a worker's most recent heartbeat."""
    cpu_percent: float | None
    memory_mb: float | None
    pinged_at: datetime

    model_config = {"from_attributes": True}


class WorkerResponse(BaseModel):
    id: uuid.UUID
    worker_id: str
    hostname: str | None
    worker_type: str
    status: str
    started_at: datetime
    last_seen_at: datetime
    stopped_at: datetime | None

    model_config = {"from_attributes": True}


class WorkerDetailResponse(WorkerResponse):
    """Worker with latest heartbeat resource stats."""
    latest_heartbeat: WorkerHeartbeatLatest | None = None
