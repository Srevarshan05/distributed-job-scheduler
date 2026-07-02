"""
backend/app/schemas/pagination.py

Generic pagination wrapper applied to all list endpoints.
`page_size` is capped at MAX_PAGE_SIZE — requests for more are silently clamped.
"""
from typing import Generic, TypeVar

from pydantic import BaseModel, Field, field_validator

T = TypeVar("T")

MAX_PAGE_SIZE: int = 100


class PaginationParams(BaseModel):
    """Query params accepted by every list endpoint."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=MAX_PAGE_SIZE)

    @field_validator("page_size", mode="before")
    @classmethod
    def clamp_page_size(cls, v: int) -> int:
        """Silently clamp to MAX_PAGE_SIZE rather than rejecting the request."""
        return min(int(v), MAX_PAGE_SIZE)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard envelope for paginated list responses."""

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int

    @classmethod
    def build(cls, items: list[T], total: int, params: PaginationParams) -> "PaginatedResponse[T]":
        pages = max(1, -(-total // params.page_size))  # ceiling division
        return cls(items=items, total=total, page=params.page, page_size=params.page_size, pages=pages)
