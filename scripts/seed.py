"""
scripts/seed.py

Creates one test user, one organization, one project, and one queue.
Run this after the Alembic migration on a fresh database.

Usage (from the repo root with venv active):
    python scripts/seed.py

The test credentials are printed to stdout — never commit real secrets.
"""
import asyncio
import sys
import os

# Allow importing backend app modules from the script
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

DATABASE_URL = os.environ["DATABASE_URL"]

# ── Seed values ───────────────────────────────────────────────────────────────
SEED_EMAIL = "admin@example.com"
SEED_PASSWORD = "password123"
SEED_FULL_NAME = "Seed Admin"
SEED_ORG_SLUG = "seed-org"
SEED_PROJECT_SLUG = "seed-project"
SEED_QUEUE_SLUG = "default"


async def seed() -> None:
    from app.core.security import hash_password
    from app.models.users import User
    from app.models.organizations import Organization, OrgMember
    from app.models.projects import Project, Queue
    from app.core.database import Base

    engine = create_async_engine(DATABASE_URL, echo=True)
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with SessionLocal() as db:
        import uuid

        # User
        user = User(
            email=SEED_EMAIL,
            hashed_password=hash_password(SEED_PASSWORD),
            full_name=SEED_FULL_NAME,
        )
        db.add(user)
        await db.flush()

        # Org
        org = Organization(name="Seed Organization", slug=SEED_ORG_SLUG)
        db.add(org)
        await db.flush()

        # Membership
        db.add(OrgMember(org_id=org.id, user_id=user.id, role="owner"))

        # Project
        project = Project(
            org_id=org.id,
            name="Seed Project",
            slug=SEED_PROJECT_SLUG,
            description="Created by the seed script.",
        )
        db.add(project)
        await db.flush()

        # Queue
        queue = Queue(
            project_id=project.id,
            name="Default Queue",
            slug=SEED_QUEUE_SLUG,
            description="Default queue for testing.",
            max_workers=3,
            retry_limit=3,
            retry_strategy="exponential",
            retry_delay_seconds=30,
        )
        db.add(queue)
        await db.commit()

        print("\n── Seed complete ───────────────────────────────")
        print(f"  User:     {SEED_EMAIL} / {SEED_PASSWORD}")
        print(f"  Org slug: {SEED_ORG_SLUG}  (id: {org.id})")
        print(f"  Project:  {SEED_PROJECT_SLUG}  (id: {project.id})")
        print(f"  Queue:    {SEED_QUEUE_SLUG}  (id: {queue.id})")
        print("────────────────────────────────────────────────\n")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
