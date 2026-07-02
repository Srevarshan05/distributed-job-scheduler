"""
backend/app/routers/organizations.py

CRUD for organizations. Every route verifies the requesting user is
a member of the org being accessed — no cross-org data leakage.
"""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.organizations import OrgMember, Organization
from app.models.users import User
from app.schemas.organizations import OrgCreateRequest, OrgResponse, OrgUpdateRequest
from app.schemas.pagination import PaginatedResponse, PaginationParams

router = APIRouter(prefix="/orgs", tags=["organizations"])


async def _require_org_member(
    org_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> OrgMember:
    """Return the membership row or raise ForbiddenError.

    Used by every org-scoped route to confirm the caller belongs to the org.
    """
    result = await db.execute(
        select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user.id)
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise ForbiddenError("You are not a member of this organization.")
    return membership


@router.post("", response_model=OrgResponse, status_code=201)
async def create_org(
    body: OrgCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Organization:
    """Create a new organization and add the caller as owner."""
    slug_check = await db.execute(select(Organization).where(Organization.slug == body.slug))
    if slug_check.scalar_one_or_none() is not None:
        raise ConflictError(f"Slug '{body.slug}' is already taken.")

    org = Organization(name=body.name, slug=body.slug)
    db.add(org)
    await db.flush()

    membership = OrgMember(org_id=org.id, user_id=current_user.id, role="owner")
    db.add(membership)
    return org


@router.get("", response_model=PaginatedResponse[OrgResponse])
async def list_orgs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[OrgResponse]:
    """List all organizations the current user belongs to."""
    params = PaginationParams(page=page, page_size=page_size)

    # Count
    count_result = await db.execute(
        select(Organization)
        .join(OrgMember, OrgMember.org_id == Organization.id)
        .where(OrgMember.user_id == current_user.id, Organization.is_active == True)  # noqa: E712
    )
    all_orgs = count_result.scalars().all()

    paginated = all_orgs[params.offset : params.offset + params.page_size]
    return PaginatedResponse.build(
        items=[OrgResponse.model_validate(o) for o in paginated],
        total=len(all_orgs),
        params=params,
    )


@router.get("/{org_id}", response_model=OrgResponse)
async def get_org(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Organization:
    """Get one organization the caller belongs to."""
    await _require_org_member(org_id, current_user, db)
    result = await db.execute(
        select(Organization).where(Organization.id == org_id, Organization.is_active == True)  # noqa: E712
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization", str(org_id))
    return org


@router.patch("/{org_id}", response_model=OrgResponse)
async def update_org(
    org_id: uuid.UUID,
    body: OrgUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Organization:
    """Update organization name. Only owners may update."""
    membership = await _require_org_member(org_id, current_user, db)
    if membership.role != "owner":
        raise ForbiddenError("Only org owners can update organization details.")

    result = await db.execute(
        select(Organization).where(Organization.id == org_id, Organization.is_active == True)  # noqa: E712
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization", str(org_id))

    if body.name is not None:
        org.name = body.name
    return org


@router.delete("/{org_id}", status_code=204)
async def soft_delete_org(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Soft-delete an organization (sets is_active=False). Owner only."""
    membership = await _require_org_member(org_id, current_user, db)
    if membership.role != "owner":
        raise ForbiddenError("Only org owners can delete the organization.")

    result = await db.execute(
        select(Organization).where(Organization.id == org_id, Organization.is_active == True)  # noqa: E712
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization", str(org_id))

    org.is_active = False
