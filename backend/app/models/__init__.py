"""
backend/app/models/__init__.py

Imports all models so Alembic's env.py (which imports Base from here)
can discover them all in one place. Never remove entries from this file
without also removing the corresponding table from a migration.
"""
from app.models.dlq import DeadLetterEntry  # noqa: F401
from app.models.jobs import Job, JobLog, JobRun  # noqa: F401
from app.models.organizations import OrgMember, Organization  # noqa: F401
from app.models.projects import Project, Queue  # noqa: F401
from app.models.users import User  # noqa: F401
from app.models.workers import Worker, WorkerHeartbeat  # noqa: F401

__all__ = [
    "User",
    "Organization",
    "OrgMember",
    "Project",
    "Queue",
    "Job",
    "JobRun",
    "JobLog",
    "Worker",
    "WorkerHeartbeat",
    "DeadLetterEntry",
]
