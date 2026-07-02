"""
backend/app/core/security.py

Password hashing and JWT creation/verification.
All cryptographic constants come from config — no literals here.
"""
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plaintext: str) -> str:
    """Return the bcrypt hash of `plaintext`."""
    return _pwd_context.hash(plaintext)


def verify_password(plaintext: str, hashed: str) -> bool:
    """Return True if `plaintext` matches `hashed`, False otherwise."""
    return _pwd_context.verify(plaintext, hashed)


def create_access_token(subject: str) -> str:
    """Create a signed JWT for `subject` (the user's UUID as a string).

    Expiry is set from ACCESS_TOKEN_EXPIRE_MINUTES in config.
    The token carries only `sub` and `exp` — nothing sensitive.
    """
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str:
    """Decode and verify a JWT; return the subject (user UUID string).

    Raises `JWTError` (from python-jose) if the token is invalid or expired.
    Callers should catch this and raise UnauthorizedError.
    """
    settings = get_settings()
    claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    subject: str | None = claims.get("sub")
    if subject is None:
        raise JWTError("Token missing 'sub' claim.")
    return subject
