"""
backend/app/routers/log_export.py

Export job logs as CSV or PDF.

Both formats share a single _fetch_job_logs() coroutine so the data-fetching
logic is written exactly once. The two routes differ only in how they format
the output.

CSV: streams as text/csv — readable in any spreadsheet application.
PDF: a simple title + table using reportlab. No decorations.
"""
import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import NotFoundError
from app.models.jobs import Job, JobLog
from app.models.organizations import OrgMember
from app.models.projects import Project, Queue
from app.models.users import User
from sqlalchemy.future import select

router = APIRouter(prefix="/queues/{queue_id}", tags=["log-export"])


async def _check_job_access(
    queue_id: uuid.UUID,
    job_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Job:
    """Verify the user can access this job and return the Job row."""
    queue_result = await db.execute(
        select(Queue).where(Queue.id == queue_id, Queue.is_active == True)  # noqa: E712
    )
    queue = queue_result.scalar_one_or_none()
    if queue is None:
        raise NotFoundError("Queue", str(queue_id))

    project_result = await db.execute(select(Project).where(Project.id == queue.project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", str(queue.project_id))

    membership = await db.execute(
        select(OrgMember).where(
            OrgMember.org_id == project.org_id, OrgMember.user_id == user.id
        )
    )
    if membership.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Access denied.")

    job_result = await db.execute(
        select(Job).where(Job.id == job_id, Job.queue_id == queue_id)
    )
    job = job_result.scalar_one_or_none()
    if job is None:
        raise NotFoundError("Job", str(job_id))
    return job


async def _fetch_job_logs(db: AsyncSession, job_id: uuid.UUID) -> list[dict]:
    """Return all log rows for a job, ordered oldest to newest.

    This is the single data-fetching function shared by both export formats.
    Adding a new export format means writing only the formatter, not re-querying.
    """
    result = await db.execute(
        text("""
            SELECT
                jl.logged_at,
                jl.level,
                jl.message,
                jr.attempt_number
            FROM job_logs jl
            LEFT JOIN job_runs jr ON jr.id = jl.run_id
            WHERE jl.job_id = :job_id
            ORDER BY jl.logged_at ASC
        """),
        {"job_id": str(job_id)},
    )
    return [dict(r) for r in result.mappings().all()]


@router.get("/jobs/{job_id}/logs/export")
async def export_job_logs(
    queue_id: uuid.UUID,
    job_id: uuid.UUID,
    format: str = Query(default="csv", pattern="^(csv|pdf)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Export job logs as CSV or PDF.

    CSV columns: timestamp, level, attempt, message
    PDF: title (Job ID + type) followed by a plain table of log entries.
    Both formats contain every log line in creation order.
    """
    job = await _check_job_access(queue_id, job_id, current_user, db)
    rows = await _fetch_job_logs(db, job_id)

    if format == "csv":
        return _build_csv_response(job, rows)
    else:
        return _build_pdf_response(job, rows)


def _build_csv_response(job: Job, rows: list[dict]) -> StreamingResponse:
    """Stream log rows as UTF-8 CSV."""
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["timestamp", "level", "attempt", "message"],
        extrasaction="ignore",
    )
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                "timestamp": row["logged_at"].isoformat() if row["logged_at"] else "",
                "level": row["level"],
                "attempt": row["attempt_number"] if row["attempt_number"] is not None else "",
                "message": row["message"],
            }
        )
    output.seek(0)
    filename = f"job-{str(job.id)[:8]}-logs.csv"
    return StreamingResponse(
        iter([output.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_pdf_response(job: Job, rows: list[dict]) -> StreamingResponse:
    """Build a plain PDF: title + table of log entries using reportlab."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4))
    styles = getSampleStyleSheet()
    elements = []

    title = Paragraph(
        f"Job Logs — {job.job_type} ({str(job.id)[:8]}…)",
        styles["Heading1"],
    )
    elements.append(title)

    # Table header + data
    data = [["Timestamp", "Level", "Attempt", "Message"]]
    for row in rows:
        ts = row["logged_at"].strftime("%Y-%m-%d %H:%M:%S") if row["logged_at"] else ""
        data.append(
            [
                ts,
                (row["level"] or "").upper(),
                str(row["attempt_number"]) if row["attempt_number"] is not None else "-",
                row["message"] or "",
            ]
        )

    table = Table(data, colWidths=[4 * cm, 2 * cm, 2 * cm, None])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.whitesmoke]),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("WORDWRAP", (3, 0), (3, -1), True),
            ]
        )
    )
    elements.append(table)
    doc.build(elements)
    buf.seek(0)

    filename = f"job-{str(job.id)[:8]}-logs.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
