"""
backend/app/core/deps.py

FastAPI dependencies shared across all routers.
Import these in route functions instead of repeating the logic per-router.
"""
import uuid

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.errors import UnauthorizedError
from app.core.security import decode_access_token
from app.models.users import User

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """FastAPI dependency: decode the bearer token and return the active User.

    Raises `UnauthorizedError` if:
    - No Authorization header is present.
    - The token is invalid or expired.
    - The user no longer exists or is inactive.
    """
    if credentials is None:
        raise UnauthorizedError()

    try:
        user_id_str = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError):
        raise UnauthorizedError("Invalid or expired token.")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))  # noqa: E712
    user = result.scalar_one_or_none()
    if user is None:
        raise UnauthorizedError("User not found or deactivated.")

    return user
