"""
backend/app/routers/auth.py

Signup and login endpoints. On signup, one organization is automatically
created for the new user so they're never stuck with no org.
"""
import re
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.errors import ConflictError, UnauthorizedError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.organizations import OrgMember, Organization
from app.models.users import User
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _email_to_slug(email: str) -> str:
    """Derive a URL-safe slug from an email address for the personal org."""
    local = email.split("@")[0].lower()
    return _SLUG_RE.sub("-", local)[:100]


@router.post("/signup", response_model=UserResponse, status_code=201)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)) -> User:
    """Register a new account and auto-create a personal organization.

    Returns the created user. Raises 409 if the email is already registered.
    """
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise ConflictError(f"Email '{body.email}' is already registered.")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    await db.flush()  # get user.id before creating the org

    # Auto-create a personal org so the user has somewhere to create projects
    slug = _email_to_slug(body.email)
    # Ensure the slug is unique by appending a short UUID suffix if needed
    slug_check = await db.execute(select(Organization).where(Organization.slug == slug))
    if slug_check.scalar_one_or_none() is not None:
        slug = f"{slug}-{str(uuid.uuid4())[:8]}"

    org = Organization(name=f"{body.full_name or body.email}'s Org", slug=slug)
    db.add(org)
    await db.flush()

    membership = OrgMember(org_id=org.id, user_id=user.id, role="owner")
    db.add(membership)

    return user


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> dict:
    """Authenticate and return a JWT bearer token.

    Raises 401 for unknown email or wrong password — same message either way
    to avoid leaking which emails are registered.
    """
    result = await db.execute(select(User).where(User.email == body.email, User.is_active == True))  # noqa: E712
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise UnauthorizedError("Invalid email or password.")

    token = create_access_token(subject=str(user.id))
    return {"access_token": token, "token_type": "bearer"}
