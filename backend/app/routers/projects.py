"""
backend/app/routers/projects.py

CRUD for projects and queues, scoped under an organization.
All routes require the caller to be a member of the target org.
"""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.organizations import OrgMember
from app.models.projects import Project, Queue
from app.models.users import User
from app.schemas.pagination import PaginatedResponse, PaginationParams
from app.schemas.projects import (
    ProjectCreateRequest,
    ProjectResponse,
    ProjectUpdateRequest,
    QueueCreateRequest,
    QueueResponse,
    QueueUpdateRequest,
)

router = APIRouter(prefix="/orgs/{org_id}", tags=["projects", "queues"])


async def _require_member(org_id: uuid.UUID, user: User, db: AsyncSession) -> OrgMember:
    """Return the membership or raise ForbiddenError."""
    result = await db.execute(
        select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user.id)
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise ForbiddenError("You are not a member of this organization.")
    return membership


# ── Projects ──────────────────────────────────────────────────────────────────

@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    org_id: uuid.UUID,
    body: ProjectCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Project:
    """Create a project inside the given organization."""
    await _require_member(org_id, current_user, db)

    slug_check = await db.execute(
        select(Project).where(Project.org_id == org_id, Project.slug == body.slug, Project.is_active == True)  # noqa: E712
    )
    if slug_check.scalar_one_or_none() is not None:
        raise ConflictError(f"Slug '{body.slug}' already exists in this organization.")

    project = Project(org_id=org_id, name=body.name, slug=body.slug, description=body.description)
    db.add(project)
    await db.flush()
    return project


@router.get("/projects", response_model=PaginatedResponse[ProjectResponse])
async def list_projects(
    org_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[ProjectResponse]:
    """List all active projects in the organization."""
    await _require_member(org_id, current_user, db)
    params = PaginationParams(page=page, page_size=page_size)

    result = await db.execute(
        select(Project).where(Project.org_id == org_id, Project.is_active == True)  # noqa: E712
    )
    all_projects = result.scalars().all()
    paginated = all_projects[params.offset : params.offset + params.page_size]
    return PaginatedResponse.build(
        items=[ProjectResponse.model_validate(p) for p in paginated],
        total=len(all_projects),
        params=params,
    )


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Project:
    await _require_member(org_id, current_user, db)
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id, Project.is_active == True)  # noqa: E712
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", str(project_id))
    return project


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    body: ProjectUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Project:
    await _require_member(org_id, current_user, db)
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id, Project.is_active == True)  # noqa: E712
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", str(project_id))

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    return project


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Soft-delete a project."""
    await _require_member(org_id, current_user, db)
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id, Project.is_active == True)  # noqa: E712
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", str(project_id))
    project.is_active = False


# ── Queues ────────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/queues", response_model=QueueResponse, status_code=201)
async def create_queue(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    body: QueueCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Queue:
    """Create a queue inside a project."""
    await _require_member(org_id, current_user, db)

    project_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id, Project.is_active == True)  # noqa: E712
    )
    if project_result.scalar_one_or_none() is None:
        raise NotFoundError("Project", str(project_id))

    slug_check = await db.execute(
        select(Queue).where(Queue.project_id == project_id, Queue.slug == body.slug, Queue.is_active == True)  # noqa: E712
    )
    if slug_check.scalar_one_or_none() is not None:
        raise ConflictError(f"Slug '{body.slug}' already exists in this project.")

    queue = Queue(
        project_id=project_id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        max_workers=body.max_workers,
        retry_limit=body.retry_limit,
        retry_strategy=body.retry_strategy,
        retry_delay_seconds=body.retry_delay_seconds,
        required_worker_type=body.required_worker_type,
        scheduling_policy=body.scheduling_policy,
    )
    db.add(queue)
    await db.flush()
    return queue


@router.get("/projects/{project_id}/queues", response_model=PaginatedResponse[QueueResponse])
async def list_queues(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[QueueResponse]:
    await _require_member(org_id, current_user, db)
    params = PaginationParams(page=page, page_size=page_size)

    result = await db.execute(
        select(Queue).where(Queue.project_id == project_id, Queue.is_active == True)  # noqa: E712
    )
    all_queues = result.scalars().all()
    paginated = all_queues[params.offset : params.offset + params.page_size]
    return PaginatedResponse.build(
        items=[QueueResponse.model_validate(q) for q in paginated],
        total=len(all_queues),
        params=params,
    )


@router.get("/projects/{project_id}/queues/{queue_id}", response_model=QueueResponse)
async def get_queue(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    queue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Queue:
    await _require_member(org_id, current_user, db)
    result = await db.execute(
        select(Queue).where(Queue.id == queue_id, Queue.project_id == project_id, Queue.is_active == True)  # noqa: E712
    )
    queue = result.scalar_one_or_none()
    if queue is None:
        raise NotFoundError("Queue", str(queue_id))
    return queue


@router.patch("/projects/{project_id}/queues/{queue_id}", response_model=QueueResponse)
async def update_queue(
    org_id: uuid.UUID,
    project_id: uuid.UUID,
    queue_id: uuid.UUID,
    body: QueueUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Queue:
    """Update queue config including pause/resume.

    Pausing a queue stops NEW claims — any job currently running is left
    alone. This is enforced in the worker's polling loop, not here.
    """
    await _require_member(org_id, current_user, db)
    result = await db.execute(
        select(Queue).where(Queue.id == queue_id, Queue.project_id == project_id, Queue.is_active == True)  # noqa: E712
    )
    queue = result.scalar_one_or_none()
    if queue is None:
        raise NotFoundError("Queue", str(queue_id))

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(queue, field, value)
    return queue
