"""
backend/app/schemas/organizations.py

Request/response schemas for organization and membership endpoints.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class OrgCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")


class OrgUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)


class OrgResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime
    role: str | None = None

    model_config = {"from_attributes": True}


class OrgMemberResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class MemberCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=255)
    role: str = Field(default="member_read_only")


class OrgMemberDetailResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str | None
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}
