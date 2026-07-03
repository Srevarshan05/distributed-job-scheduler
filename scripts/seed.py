"""
scripts/seed.py

Creates one test user, one organization, one project, and two queues.
Run this after the Alembic migration on a fresh database.

Usage (from the repo root with venv active):
    python scripts/seed.py              # always seeds (fails if already seeded)
    python scripts/seed.py --if-empty  # safe to call on every restart; skips if data exists

The test credentials are printed to stdout — never commit real secrets.
"""
import asyncio
import sys
import os

# Allow importing backend app modules from the script (both local and docker paths)
_parent_dir = os.path.join(os.path.dirname(__file__), "..")
_backend_dir = os.path.join(_parent_dir, "backend")
sys.path.insert(0, _parent_dir)
if os.path.exists(_backend_dir):
    sys.path.insert(0, _backend_dir)

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from dotenv import load_dotenv

# Load backend .env when running locally; in Docker DATABASE_URL is injected via environment
_env_path = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path)

DATABASE_URL = os.environ["DATABASE_URL"]

# ── Seed values ───────────────────────────────────────────────────────────────
SEED_EMAIL = "admin@example.com"
SEED_PASSWORD = "password123"
SEED_FULL_NAME = "Seed Admin"
SEED_ORG_SLUG = "seed-org"
SEED_PROJECT_SLUG = "seed-project"
SEED_QUEUE_SLUG = "default"


async def already_seeded(engine) -> bool:
    """Return True if the seed admin user already exists — used by --if-empty."""
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT 1 FROM users WHERE email = :email LIMIT 1"),
            {"email": SEED_EMAIL},
        )
        return result.first() is not None


async def seed() -> None:
    from app.core.security import hash_password
    from app.models.users import User
    from app.models.organizations import Organization, OrgMember
    from app.models.projects import Project, Queue
    from app.models.jobs import Job

    engine = create_async_engine(DATABASE_URL, echo=False)
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with SessionLocal() as db:
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

        # Queue — Standard
        queue = Queue(
            project_id=project.id,
            name="Default Queue",
            slug=SEED_QUEUE_SLUG,
            description="Default queue for standard tasks.",
            max_workers=3,
            retry_limit=3,
            retry_strategy="exponential",
            retry_delay_seconds=30,
            required_worker_type="standard",
            scheduling_policy="priority",
        )
        db.add(queue)
        await db.flush()

        # Queue — High Compute
        high_compute_queue = Queue(
            project_id=project.id,
            name="High Compute Queue",
            slug="high-compute",
            description="Queue for resource-heavy computing tasks.",
            max_workers=2,
            retry_limit=2,
            retry_strategy="exponential",
            retry_delay_seconds=60,
            required_worker_type="high_compute",
            scheduling_policy="priority",
        )
        db.add(high_compute_queue)
        await db.flush()

        # Seed Jobs
        job1 = Job(
            queue_id=queue.id,
            job_type="send_email",
            payload={"to": "user1@example.com", "subject": "Welcome to Codity!"},
            priority=10,
            max_attempts=3,
            created_by_user_id=user.id,
        )
        job2 = Job(
            queue_id=queue.id,
            job_type="send_email",
            payload={"to": "user2@example.com", "subject": "Monthly Digest"},
            priority=50,
            max_attempts=3,
            created_by_user_id=user.id,
        )
        job3 = Job(
            queue_id=high_compute_queue.id,
            job_type="cpu_burn",
            payload={"iterations": 10000},
            priority=20,
            max_attempts=3,
            created_by_user_id=user.id,
        )
        job4 = Job(
            queue_id=high_compute_queue.id,
            job_type="cpu_burn",
            payload={"iterations": 30000},
            priority=80,
            max_attempts=3,
            created_by_user_id=user.id,
        )

        db.add_all([job1, job2, job3, job4])
        await db.commit()

        print("\n== Seed complete ===============================")
        print(f"  User:         {SEED_EMAIL} / {SEED_PASSWORD}")
        print(f"  Org slug:     {SEED_ORG_SLUG}  (id: {org.id})")
        print(f"  Project:      {SEED_PROJECT_SLUG}  (id: {project.id})")
        print(f"  Default Q:    {SEED_QUEUE_SLUG}  (id: {queue.id})")
        print(f"  High Comp Q:  high-compute  (id: {high_compute_queue.id})")
        print("================================================\n")

    await engine.dispose()


async def main() -> None:
    if_empty = "--if-empty" in sys.argv
    engine = create_async_engine(DATABASE_URL, echo=False)

    if if_empty and await already_seeded(engine):
        print("==> Seed skipped: database already contains seed data.")
        print("==> Ensuring admin user password is up to date with correct hash...")
        from app.core.security import hash_password
        SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
        async with SessionLocal() as db:
            await db.execute(
                text("UPDATE users SET hashed_password = :hash WHERE email = :email"),
                {"email": SEED_EMAIL, "hash": hash_password(SEED_PASSWORD)},
            )
            await db.commit()
        print("==> Admin password successfully updated.")
        await engine.dispose()
        return

    await engine.dispose()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
