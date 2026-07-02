"""
backend/app/core/errors.py

Unified error response shapes for the entire API.
No raw stack traces ever reach the client.

Every API error follows the envelope:
    {"error": {"code": "<machine_readable_code>", "message": "<human_readable>"}}
"""
from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Base class for all application-defined errors.

    Raise subclasses of this instead of returning error dicts directly —
    the global handler converts them to the standard envelope automatically.
    """

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class NotFoundError(AppError):
    """Resource does not exist or is not visible to the caller."""

    def __init__(self, resource: str, resource_id: str | int) -> None:
        super().__init__(
            code="NOT_FOUND",
            message=f"{resource} '{resource_id}' not found.",
            status_code=404,
        )


class UnauthorizedError(AppError):
    """Request is missing or carries an invalid authentication token."""

    def __init__(self, message: str = "Authentication required.") -> None:
        super().__init__(code="UNAUTHORIZED", message=message, status_code=401)


class ForbiddenError(AppError):
    """Caller is authenticated but not allowed to perform this action."""

    def __init__(self, message: str = "Access denied.") -> None:
        super().__init__(code="FORBIDDEN", message=message, status_code=403)


class ConflictError(AppError):
    """Operation would violate a uniqueness or business rule."""

    def __init__(self, message: str) -> None:
        super().__init__(code="CONFLICT", message=message, status_code=409)


class ValidationError(AppError):
    """Request payload failed domain-level validation beyond Pydantic."""

    def __init__(self, message: str) -> None:
        super().__init__(code="VALIDATION_ERROR", message=message, status_code=422)


def _error_envelope(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Global handler registered on the FastAPI app for all AppError subclasses."""
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_envelope(exc.code, exc.message),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for any exception that escaped normal handling.

    Logs the real error server-side; sends a generic message to the client
    so stack traces never leak externally.
    """
    import logging

    logging.getLogger("api").exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content=_error_envelope("INTERNAL_ERROR", "An unexpected error occurred."),
    )
