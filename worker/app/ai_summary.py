"""
worker/app/ai_summary.py

Asynchronous AI-generated failure summary loader for jobs promoted to the DLQ.
Uses Groq API to summarize error messages into plain English.

Fully isolated: failures or missing keys do not impact core scheduling logic.
"""
import logging
import os
from datetime import datetime, timezone
import httpx
from sqlalchemy import text
from dotenv import load_dotenv
from app.core.database import get_db_session

# Load env variables (including GROQ_API_KEY) from .env in current working directory
load_dotenv()

logger = logging.getLogger("worker.ai_summary")

# Recommend standard production model on Groq
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


async def fetch_summary_from_groq(
    job_type: str,
    queue_name: str,
    retry_policy: str,
    attempt_count: int,
    max_attempts: int,
    failure_reasons: list[str],
) -> str | None:
    """Make the HTTP POST request to Groq API to generate the summary."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        logger.debug("GROQ_API_KEY is not set. Skipping AI summary generation.")
        return None

    # Construct clean prompt template as requested
    reasons_list = "\n".join(f"- Attempt {i+1}: {r}" for i, r in enumerate(failure_reasons))
    prompt = f"""You are explaining a background job failure to a developer who has never seen this specific error before. Be concise and factual — 2 to 4 sentences. Do not guess beyond what the data shows. If the cause is unclear from the data given, say so plainly instead of inventing a reason.

Job: {job_type} ({job_type})
Queue: {queue_name}, retry policy: {retry_policy}
Attempts: {attempt_count} of {max_attempts}

Failure reasons per attempt:
{reasons_list}

Explain in plain language why this job most likely failed, and suggest one concrete thing worth checking first."""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "temperature": 0.2,
        "max_tokens": 150,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(GROQ_API_URL, headers=headers, json=payload)
            if response.status_code == 200:
                data = response.json()
                summary = data["choices"][0]["message"]["content"]
                return summary.strip()
            else:
                logger.warning(
                    "Groq API returned status code %d: %s",
                    response.status_code,
                    response.text,
                )
                return None
    except Exception as e:
        logger.warning("Failed to contact Groq API: %s", str(e))
        return None


async def generate_and_save_ai_summary(job_id: str, queue_id: str) -> None:
    """Asynchronously load details, call LLM, and update the DLQ row.

    Never blocks the main claim or execution path.
    """
    logger.info("Triggered AI summary generation for job_id=%s", job_id)
    try:
        async with get_db_session() as db:
            # 1. Fetch Job info, Queue info, and JobRuns
            job_res = await db.execute(
                text(
                    "SELECT job_type, max_attempts, attempts_made FROM jobs WHERE id = :job_id"
                ),
                {"job_id": job_id},
            )
            job = job_res.mappings().first()
            if not job:
                logger.warning("Job not found during AI summary: job_id=%s", job_id)
                return

            queue_res = await db.execute(
                text(
                    "SELECT name, retry_strategy, retry_delay_seconds FROM queues WHERE id = :queue_id"
                ),
                {"queue_id": queue_id},
            )
            queue = queue_res.mappings().first()
            if not queue:
                logger.warning("Queue not found during AI summary: queue_id=%s", queue_id)
                return

            runs_res = await db.execute(
                text(
                    "SELECT error_message FROM job_runs WHERE job_id = :job_id ORDER BY attempt_number ASC"
                ),
                {"job_id": job_id},
            )
            runs = runs_res.mappings().all()

            failure_reasons = [
                r["error_message"] for r in runs if r["error_message"]
            ]
            if not failure_reasons:
                failure_reasons = ["Unknown error or no details recorded."]

            retry_policy = (
                f"{queue['retry_strategy']} (delay: {queue['retry_delay_seconds']}s)"
            )

            # 2. Call API
            summary = await fetch_summary_from_groq(
                job_type=job["job_type"],
                queue_name=queue["name"],
                retry_policy=retry_policy,
                attempt_count=job["attempts_made"],
                max_attempts=job["max_attempts"],
                failure_reasons=failure_reasons,
            )

            if summary:
                # 3. Save to dead_letter_queue
                await db.execute(
                    text(
                        "UPDATE dead_letter_queue "
                        "SET ai_failure_summary = :summary, ai_summary_generated_at = :now "
                        "WHERE job_id = :job_id"
                    ),
                    {
                        "summary": summary,
                        "now": datetime.now(timezone.utc),
                        "job_id": job_id,
                    },
                )
                await db.commit()
                logger.info("Successfully saved AI summary for job_id=%s", job_id)
            else:
                # Store fallback text so UI doesn't spin or show blank
                await db.execute(
                    text(
                        "UPDATE dead_letter_queue "
                        "SET ai_failure_summary = 'AI explanation not available (generation skipped or failed)', "
                        "    ai_summary_generated_at = :now "
                        "WHERE job_id = :job_id"
                    ),
                    {"now": datetime.now(timezone.utc), "job_id": job_id},
                )
                await db.commit()
    except Exception as e:
        logger.error(
            "Exception in generate_and_save_ai_summary for job_id=%s: %s",
            job_id,
            str(e),
            exc_info=True,
        )
