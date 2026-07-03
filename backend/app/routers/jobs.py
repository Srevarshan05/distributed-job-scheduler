"""
backend/app/routers/jobs.py

Job creation (single + batch), listing, detail, cancel, and DLQ retry.
All routes require authentication and membership in the owning org.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.resilience import retry_on_db_lock
from app.models.dlq import DeadLetterEntry
from app.models.jobs import (
    JOB_STATUS_CANCELLED,
    JOB_STATUS_DEAD,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SCHEDULED,
    Job,
)
from app.models.organizations import OrgMember
from app.models.projects import Project, Queue
from app.models.users import User
from app.schemas.jobs import (
    DLQEntryResponse,
    JobBatchCreateRequest,
    JobCancelResponse,
    JobCreateRequest,
    JobDetailResponse,
    JobResponse,
    JobRetryResponse,
)
from app.schemas.pagination import PaginatedResponse, PaginationParams

router = APIRouter(prefix="/queues/{queue_id}", tags=["jobs"])
dlq_router = APIRouter(prefix="/dlq", tags=["dead-letter-queue"])


async def _resolve_queue_and_check_access(
    queue_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Queue:
    """Load the queue and confirm the caller's org membership.

    Raises NotFoundError if the queue doesn't exist; ForbiddenError if
    the user doesn't belong to the org that owns this queue.
    """
    result = await db.execute(
        select(Queue)
        .where(Queue.id == queue_id, Queue.is_active == True)  # noqa: E712
    )
    queue = result.scalar_one_or_none()
    if queue is None:
        raise NotFoundError("Queue", str(queue_id))

    # Verify org membership via the project → org chain
    project_result = await db.execute(select(Project).where(Project.id == queue.project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", str(queue.project_id))

    membership = await db.execute(
        select(OrgMember).where(OrgMember.org_id == project.org_id, OrgMember.user_id == user.id)
    )
    if membership.scalar_one_or_none() is None:
        raise ForbiddenError("You do not have access to this queue.")

    return queue


def _build_job(queue_id: uuid.UUID, body: JobCreateRequest, user_id: uuid.UUID) -> Job:
    """Construct a Job ORM object from a create request.

    Sets initial status to 'scheduled' when run_at is in the future,
    otherwise 'queued' for immediate dispatch.
    """
    now = datetime.now(timezone.utc)
    run_at = body.run_at or now
    status = JOB_STATUS_SCHEDULED if run_at > now else JOB_STATUS_QUEUED

    return Job(
        queue_id=queue_id,
        job_type=body.job_type,
        payload=body.payload,
        priority=body.priority,
        run_at=run_at,
        cron_expression=body.cron_expression,
        max_attempts=body.max_attempts,
        status=status,
        created_by_user_id=user_id,
        idempotency_key=body.idempotency_key,
    )


@router.post("/jobs", response_model=JobResponse, status_code=201)
@retry_on_db_lock()
async def create_job(
    queue_id: uuid.UUID,
    body: JobCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobResponse:
    """Submit one job to the queue.

    If an optional idempotency_key is provided and a job with the same key
    already exists in the queue, we return the existing job (idempotent response).
    """
    await _resolve_queue_and_check_access(queue_id, current_user, db)

    # Idempotency safety: check if job with key already exists
    if body.idempotency_key:
        existing = await db.execute(
            select(Job).where(Job.queue_id == queue_id, Job.idempotency_key == body.idempotency_key)
        )
        existing_job = existing.scalar_one_or_none()
        if existing_job:
            resp = JobResponse.model_validate(existing_job)
            if existing_job.created_by_user_id == current_user.id:
                resp.created_by_email = current_user.email
            else:
                user_res = await db.execute(select(User.email).where(User.id == existing_job.created_by_user_id))
                resp.created_by_email = user_res.scalar() or "system"
            return resp

    job = _build_job(queue_id, body, current_user.id)
    db.add(job)
    await db.flush()
    await db.refresh(job)
    resp = JobResponse.model_validate(job)
    resp.created_by_email = current_user.email
    return resp


@router.post("/jobs/batch", response_model=list[JobResponse], status_code=201)
@retry_on_db_lock()
async def create_jobs_batch(
    queue_id: uuid.UUID,
    body: JobBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[JobResponse]:
    """Submit multiple jobs in a single transaction. All succeed or none do.

    For each job, if an idempotency_key is provided and it already exists,
    the existing job is returned instead of creating a duplicate.
    """
    await _resolve_queue_and_check_access(queue_id, current_user, db)
    results = []
    for req in body.jobs:
        if req.idempotency_key:
            existing = await db.execute(
                select(Job).where(Job.queue_id == queue_id, Job.idempotency_key == req.idempotency_key)
            )
            existing_job = existing.scalar_one_or_none()
            if existing_job:
                resp = JobResponse.model_validate(existing_job)
                if existing_job.created_by_user_id == current_user.id:
                    resp.created_by_email = current_user.email
                else:
                    user_res = await db.execute(select(User.email).where(User.id == existing_job.created_by_user_id))
                    resp.created_by_email = user_res.scalar() or "system"
                results.append(resp)
                continue

        job = _build_job(queue_id, req, current_user.id)
        db.add(job)
        await db.flush()
        await db.refresh(job)
        resp = JobResponse.model_validate(job)
        resp.created_by_email = current_user.email
        results.append(resp)

    return results


@router.get("/jobs", response_model=PaginatedResponse[JobResponse])
async def list_jobs(
    queue_id: uuid.UUID,
    status: str | None = Query(default=None),
    job_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[JobResponse]:
    """List jobs in a queue with optional status/type filters.

    Resolves creator email addresses in a single batched query (no N+1)
    and attaches them to each JobResponse for attribution display.
    """
    await _resolve_queue_and_check_access(queue_id, current_user, db)
    params = PaginationParams(page=page, page_size=page_size)

    query = select(Job).where(Job.queue_id == queue_id)
    if status:
        query = query.where(Job.status == status)
    if job_type:
        query = query.where(Job.job_type == job_type)

    result = await db.execute(query.order_by(Job.created_at.desc()))
    all_jobs = result.scalars().all()
    paginated = all_jobs[params.offset : params.offset + params.page_size]

    # ── Batch-resolve creator emails (single query, no N+1) ───────────────
    creator_ids = {
        j.created_by_user_id for j in paginated if j.created_by_user_id is not None
    }
    email_map: dict[uuid.UUID, str] = {}
    if creator_ids:
        user_rows = await db.execute(
            select(User.id, User.email).where(User.id.in_(creator_ids))
        )
        email_map = {row.id: row.email for row in user_rows}

    items = []
    for j in paginated:
        resp = JobResponse.model_validate(j)
        resp.created_by_email = email_map.get(j.created_by_user_id, "system")
        items.append(resp)

    return PaginatedResponse.build(
        items=items,
        total=len(all_jobs),
        params=params,
    )


@router.get("/jobs/{job_id}", response_model=JobDetailResponse)
async def get_job(
    queue_id: uuid.UUID,
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobDetailResponse:
    """Get full job detail: overview, live queue position, attempt history, logs.

    queue_position is computed live from the DB at request time — it is the
    number of jobs ahead of this one under the queue's scheduling policy.
    It is None when the job is not in a queued/scheduled state.
    """
    queue = await _resolve_queue_and_check_access(queue_id, current_user, db)

    result = await db.execute(
        select(Job)
        .where(Job.id == job_id, Job.queue_id == queue_id)
        .options(selectinload(Job.runs), selectinload(Job.logs))
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise NotFoundError("Job", str(job_id))

    # ── Live queue position ────────────────────────────────────────────────
    queue_position: int | None = None
    if job.status in (JOB_STATUS_QUEUED, JOB_STATUS_SCHEDULED):
        policy = getattr(queue, "scheduling_policy", "priority")
        if policy == "fifo":
            pos_result = await db.execute(
                select(func.count()).select_from(Job).where(
                    Job.queue_id == queue_id,
                    Job.status.in_([JOB_STATUS_QUEUED, JOB_STATUS_SCHEDULED]),
                    Job.run_at <= job.run_at,
                    Job.created_at < job.created_at,
                )
            )
        else:
            # priority and fair_share: higher priority first, then earlier creation
            pos_result = await db.execute(
                select(func.count()).select_from(Job).where(
                    Job.queue_id == queue_id,
                    Job.status.in_([JOB_STATUS_QUEUED, JOB_STATUS_SCHEDULED]),
                    (
                        (Job.priority > job.priority) |
                        ((Job.priority == job.priority) & (Job.created_at < job.created_at))
                    ),
                )
            )
        queue_position = pos_result.scalar_one()

    # ── Claimed worker hostname ────────────────────────────────────────────
    claimed_hostname: str | None = None
    if job.claimed_by_worker_id:
        from app.models.workers import Worker
        wk_result = await db.execute(
            select(Worker).where(Worker.worker_id == job.claimed_by_worker_id)
        )
        wk = wk_result.scalar_one_or_none()
        if wk is not None:
            claimed_hostname = wk.hostname

    # ── Submitting user email ──────────────────────────────────────────────
    created_by_email: str | None = None
    if job.created_by_user_id:
        from app.models.users import User as UserModel
        u_result = await db.execute(
            select(UserModel).where(UserModel.id == job.created_by_user_id)
        )
        u = u_result.scalar_one_or_none()
        if u is not None:
            created_by_email = u.email

    # ── AI Failure Summary (Phase 10.5) ────────────────────────────────────
    ai_failure_summary: str | None = None
    if job.status == "dead":
        from app.models.dlq import DeadLetterEntry
        dlq_result = await db.execute(
            select(DeadLetterEntry.ai_failure_summary)
            .where(DeadLetterEntry.job_id == job_id)
        )
        ai_failure_summary = dlq_result.scalar_one_or_none()

    return JobDetailResponse(
        id=job.id,
        queue_id=job.queue_id,
        job_type=job.job_type,
        payload=job.payload,
        priority=job.priority,
        status=job.status,
        attempts_made=job.attempts_made,
        max_attempts=job.max_attempts,
        run_at=job.run_at,
        cron_expression=job.cron_expression,
        claimed_by_worker_id=job.claimed_by_worker_id,
        claimed_at=job.claimed_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
        queue_name=queue.name,
        queue_position=queue_position,
        claimed_worker_hostname=claimed_hostname,
        created_by_email=created_by_email,
        runs=job.runs,
        logs=sorted(job.logs, key=lambda l: l.logged_at),
        ai_failure_summary=ai_failure_summary,
    )


@router.post("/jobs/{job_id}/cancel", response_model=JobCancelResponse)
@retry_on_db_lock()
async def cancel_job(
    queue_id: uuid.UUID,
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Cancel a job that is still queued or scheduled.

    Jobs in 'running' status cannot be safely cancelled without the worker's
    cooperation — that is deliberately out of scope. See design_decisions.md.
    """
    await _resolve_queue_and_check_access(queue_id, current_user, db)
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.queue_id == queue_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise NotFoundError("Job", str(job_id))

    if job.status == JOB_STATUS_RUNNING:
        raise ValidationError(
            "Cannot cancel a running job. "
            "Stop the owning worker or wait for it to finish."
        )
    if job.status not in (JOB_STATUS_QUEUED, JOB_STATUS_SCHEDULED):
        raise ValidationError(f"Job is already in terminal state '{job.status}'.")

    job.status = JOB_STATUS_CANCELLED
    return {"job_id": job.id, "message": "Job cancelled."}


# ── Dead-letter queue ─────────────────────────────────────────────────────────

@dlq_router.get("/queues/{queue_id}/dlq", response_model=PaginatedResponse[DLQEntryResponse])
async def list_dlq(
    queue_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[DLQEntryResponse]:
    """List dead-letter entries for a queue."""
    await _resolve_queue_and_check_access(queue_id, current_user, db)
    params = PaginationParams(page=page, page_size=page_size)

    result = await db.execute(
        select(DeadLetterEntry)
        .where(DeadLetterEntry.queue_id == queue_id)
        .options(selectinload(DeadLetterEntry.job))
        .order_by(DeadLetterEntry.promoted_at.desc())
    )
    all_entries = result.scalars().all()
    paginated = all_entries[params.offset : params.offset + params.page_size]

    items = []
    for e in paginated:
        resp = DLQEntryResponse.model_validate(e)
        if e.job:
            resp.job_type = e.job.job_type
        items.append(resp)

    return PaginatedResponse.build(
        items=items,
        total=len(all_entries),
        params=params,
    )


@dlq_router.post("/dlq/{dlq_id}/retry", response_model=JobRetryResponse)
@retry_on_db_lock()
async def retry_dlq_entry(
    dlq_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Manually retry a dead job by creating a fresh job row with attempts_made=0.

    The original DLQ entry is updated with who triggered the retry and when.
    The original job row remains as `dead` for full traceability.
    """
    entry_result = await db.execute(
        select(DeadLetterEntry).where(DeadLetterEntry.id == dlq_id)
    )
    entry = entry_result.scalar_one_or_none()
    if entry is None:
        raise NotFoundError("DLQ entry", str(dlq_id))

    if entry.retry_job_id is not None:
        raise ConflictError("This DLQ entry has already been retried.")

    # Load original job to copy its config
    job_result = await db.execute(select(Job).where(Job.id == entry.job_id))
    original_job = job_result.scalar_one_or_none()
    if original_job is None:
        raise NotFoundError("Job", str(entry.job_id))

    new_job = Job(
        queue_id=original_job.queue_id,
        job_type=original_job.job_type,
        payload=original_job.payload,
        priority=original_job.priority,
        max_attempts=original_job.max_attempts,
        status=JOB_STATUS_QUEUED,
        created_by_user_id=current_user.id,
    )
    db.add(new_job)
    await db.flush()

    entry.retried_at = datetime.now(timezone.utc)
    entry.retried_by_user_id = current_user.id
    entry.retry_job_id = new_job.id

    return {
        "original_job_id": original_job.id,
        "new_job_id": new_job.id,
        "message": "Job re-queued successfully.",
    }
