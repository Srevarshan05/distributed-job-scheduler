# Design Decisions — JobScheduler

This document records the architectural decisions and engineering rationales behind key components of the JobScheduler system.

---

## 1. Asynchronous & Isolated AI Failure Summaries (Phase 10.5)

### Decision
The AI-generated failure summary call (via Groq API) is designed to run **asynchronously** and is **fully isolated** from the core scheduling logic.

### Rationale
* **Reliability (Fault Tolerance):** AI summary generation relies on an external API (Groq). Under no circumstances should network issues, API rate limits, or credentials problems block the primary job failure path.
* **Separation of Concerns:** The code is completely self-contained in `worker/app/ai_summary.py`. The scheduling/execution loop inside `executor.py` triggers it as a fire-and-forget background task using Python's `asyncio.create_task()`.
* **Zero Performance Impact:** Core worker threads are never blocked. The job transitions to `dead` and is promoted to the DLQ in a single database transaction immediately, without waiting for the HTTP call to finish.
* **Failure Fallback:** If the API call fails or times out, a plain fallback summary is saved, ensuring the UI always displays a clear state.
