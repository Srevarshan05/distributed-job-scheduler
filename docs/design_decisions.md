# Design Decisions — JobRunR Distributed Job Scheduler

This document records the architectural decisions and engineering rationales behind key components of the system. It exists so that design choices are explicit, not implied — each entry explains *why* a path was taken and *what was deliberately rejected*.

---

## 1. Asynchronous & Isolated AI Failure Summaries

### Decision
The AI-generated failure summary call (via Groq API) runs **asynchronously** and is **fully isolated** from the core scheduling logic.

### Rationale
- **Reliability:** AI summary generation depends on an external API. Network issues, rate limits, or missing credentials must never block the primary job-failure path.
- **Separation of concerns:** The feature is completely self-contained in `worker/app/ai_summary.py`. The executor triggers it as a fire-and-forget `asyncio.create_task()`.
- **Zero performance impact:** Core worker threads are never blocked. The job transitions to `dead` and the DLQ row is created in a single DB transaction without waiting for the HTTP call.
- **Failure fallback:** If the API call fails or times out, a plain fallback summary is saved so the UI always shows a clear state.

---

## 2. `SELECT FOR UPDATE SKIP LOCKED` Instead of a Message Broker

### Decision
Atomic job claiming is implemented with a PostgreSQL `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` — no Redis, RabbitMQ, or external queue.

### Rationale
- **Exactly-once claim semantics** within a DB transaction, with no external dependency. A broker adds an operational dependency for zero reliability gain when Postgres already provides this primitive.
- **SKIP LOCKED** means a worker that cannot acquire the row lock immediately moves to the next eligible job — 200 workers polling the same queue will not pile up behind a single lock.
- **A separate lock table** would require two round-trips and a compensating DELETE on failure. `FOR UPDATE SKIP LOCKED` is atomic and built into the engine we already depend on.
- **Traceability:** Postgres transactions are logged, observable, and recoverable. Broker messages in memory are not.

---

## 3. Embedded Retry Policy vs. Separate `retry_policies` Table

### Decision
Retry configuration (`retry_strategy`, `retry_delay_seconds`, `retry_limit`) is stored as columns on the `queues` table, not in a separate `retry_policies` table.

### Rationale
A separate `retry_policies` table would only be justified if the same policy needed to be shared across multiple queues (classic normalization argument). In this system, a retry policy belongs to exactly one queue and has no identity outside of it. A dedicated table would add a join on every claim query with zero normalization benefit.

If multi-queue policy sharing were required in the future, extracting to a separate table is a straightforward migration. The current design does not pay that cost upfront.

---

## 4. Scheduled Jobs as Columns on `jobs`, Not a Separate Table

### Decision
Scheduling metadata (`run_at`, `cron_expression`) lives on the `jobs` table itself. There is no separate `scheduled_jobs` table.

### Rationale
A `scheduled_jobs` table would create a 1:1 relationship with `jobs` (every scheduled job is still a job) and would require a join on every poll query. Embedding `run_at` and `cron_expression` directly on `jobs` allows the poll index — `WHERE status IN ('queued','scheduled') AND run_at <= NOW()` — to be a single indexed scan. Recurring jobs simply insert a new `jobs` row after each execution; the cron row is never reused, so every run has its own complete history.

---

## 5. One Worker Image, Two Services (Parameterised by `WORKER_TYPE`)

### Decision
`worker-standard` and `worker-highcompute` in `docker-compose.yml` share the **same Docker image**, built once from `worker/Dockerfile`, and are differentiated at runtime by the `WORKER_TYPE` environment variable.

### Rationale
Maintaining two near-identical Dockerfiles with the same base image and dependencies would violate the rule against unjustified duplication. The only difference between the two worker services is *which queue types they claim from* — a runtime routing decision, not a build-time image difference. One image built once reduces CI build time, image registry storage, and the surface for divergence between the two services.

---

## 6. `max_workers` Concurrency Enforcement at Claim Time

### Decision
The queue's `max_workers` limit is enforced inside `claim_next_job` by:
1. Locking the queue row (`SELECT … FOR UPDATE`) to serialize claims on this queue.
2. Counting active jobs (`status IN ('claimed', 'running')`) before proceeding.
3. Returning `None` (skip this queue) if the count meets or exceeds `max_workers`.

### Rationale
A simple in-memory semaphore would only work within a single worker process. With multiple worker processes running concurrently, the enforcement must happen inside the database. Locking the queue row serializes claiming on that queue, making the count-and-claim sequence race-free. The lock is held only for the duration of the claim transaction (milliseconds), so throughput impact is negligible.

---

## 7. Idempotency Keys as an Optional Client-Side Feature

### Decision
`idempotency_key` is an optional `VARCHAR(255)` column on `jobs`. If provided, job creation checks for an existing job with the same key on the same queue and returns the existing job rather than creating a duplicate.

### Rationale
Idempotency matters most for retry-prone callers: HTTP timeouts, network retries, and batch imports where the client cannot know whether a previous request succeeded. Making the key optional means zero-cost for callers that don't need it. The check is a single indexed lookup on `idempotency_key`, added to the schema via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on startup (idempotent itself).

---

## 8. Orphan Recovery: 3× Heartbeat Multiplier

### Decision
A job is considered orphaned (and re-queued) when its worker has missed 3 consecutive heartbeat windows (`orphan_timeout = 3 × heartbeat_interval`).

### Rationale
A single missed heartbeat can result from a transient DB hiccup that the worker will recover from immediately. Re-queuing on a single miss would cause spurious double-execution. Three consecutive misses means the worker is almost certainly dead (process killed, machine lost network). This is a deliberate trade-off: slightly slower orphan detection in exchange for avoiding false positives.

---

## 9. Two-Server Split (API on 8000, Worker on 8001)

### Decision
The API server (FastAPI, port 8000) and the worker (FastAPI + polling loop, port 8001) are separate processes.

### Rationale
The worker's polling loop is a long-running background task that holds open DB connections continuously. Mixing it into the API server process would mean a single crash takes down both the API and all in-flight jobs. Separation also means workers can be scaled horizontally without scaling the API, and vice versa. The WebSocket connection for live updates comes from the worker so that job-status events are broadcast from the process that actually runs the jobs, without an inter-process message hop.

---

## 10. Database Schema Migrations (Alembic) + Safe Startup Upgrade

### Decision
All schema changes use Alembic migrations. The backend entrypoint runs `alembic upgrade head` before starting uvicorn.

### Rationale
This guarantees the schema is always current when the server starts — no manual migration step. Running `upgrade head` is idempotent: if migrations are already applied, Alembic returns immediately. The `idempotency_key` column is additionally ensured via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the FastAPI lifespan handler for robustness.
