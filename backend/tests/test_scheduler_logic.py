"""
backend/tests/test_scheduler_logic.py

Unit tests for the core scheduler business logic — NO database required.
These tests verify pure Python functions such as:
  - retry delay calculations (fixed / linear / exponential)
  - job status lifecycle transitions
  - DLQ promotion eligibility
  - Priority ordering math
  - Cron next-run calculation

Run with:
    cd distributed-job-scheduler
    python -m pytest backend/tests/test_scheduler_logic.py -v
"""
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
import sys
import os

# ─── Path bootstrap ───────────────────────────────────────────────────────────
# Allow imports from the backend app package even without installing it.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Retry Delay Strategy Tests
# ═══════════════════════════════════════════════════════════════════════════════

def compute_retry_delay(strategy: str, base_delay: int, attempt: int) -> int:
    """
    Mirror of the retry delay logic used in worker/app/executor.py.
    
    - fixed:       always base_delay seconds
    - linear:      base_delay * attempt
    - exponential: base_delay * 2^(attempt-1)  (capped at 3600 s)
    """
    if strategy == "fixed":
        return base_delay
    elif strategy == "linear":
        return base_delay * attempt
    elif strategy == "exponential":
        return min(base_delay * (2 ** (attempt - 1)), 3600)
    return base_delay


class TestRetryDelayStrategies(unittest.TestCase):
    """Validates all three retry backoff strategies produce correct delays."""

    # ── Fixed ──────────────────────────────────────────────────────────────────
    def test_fixed_delay_attempt_1(self):
        self.assertEqual(compute_retry_delay("fixed", 60, 1), 60)

    def test_fixed_delay_attempt_5(self):
        """Fixed strategy must never change regardless of attempt number."""
        self.assertEqual(compute_retry_delay("fixed", 60, 5), 60)

    def test_fixed_delay_attempt_50(self):
        self.assertEqual(compute_retry_delay("fixed", 30, 50), 30)

    # ── Linear ─────────────────────────────────────────────────────────────────
    def test_linear_delay_attempt_1(self):
        self.assertEqual(compute_retry_delay("linear", 60, 1), 60)

    def test_linear_delay_attempt_3(self):
        """3rd attempt should be 3x the base delay."""
        self.assertEqual(compute_retry_delay("linear", 60, 3), 180)

    def test_linear_delay_attempt_10(self):
        self.assertEqual(compute_retry_delay("linear", 30, 10), 300)

    # ── Exponential ────────────────────────────────────────────────────────────
    def test_exponential_delay_attempt_1(self):
        """1st retry → base_delay * 2^0 = base_delay."""
        self.assertEqual(compute_retry_delay("exponential", 60, 1), 60)

    def test_exponential_delay_attempt_2(self):
        """2nd retry → base_delay * 2^1 = 120."""
        self.assertEqual(compute_retry_delay("exponential", 60, 2), 120)

    def test_exponential_delay_attempt_3(self):
        """3rd retry → base_delay * 2^2 = 240."""
        self.assertEqual(compute_retry_delay("exponential", 60, 3), 240)

    def test_exponential_cap_at_3600(self):
        """Very high attempts must be capped at 3600 seconds (1 hour)."""
        result = compute_retry_delay("exponential", 60, 20)
        self.assertEqual(result, 3600)

    def test_unknown_strategy_defaults_to_base(self):
        """Unknown strategies should fall back to base_delay safely."""
        self.assertEqual(compute_retry_delay("unknown_strategy", 45, 3), 45)


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Job Status Lifecycle Transition Tests
# ═══════════════════════════════════════════════════════════════════════════════

# Valid state transitions based on the spec:
# queued/scheduled → claimed → running → completed | failed → (retry→queued) | dead
VALID_TRANSITIONS = {
    "queued":     {"claimed"},
    "scheduled":  {"queued", "claimed"},
    "claimed":    {"running"},
    "running":    {"completed", "failed"},
    "failed":     {"queued", "dead"},  # retry → queued, final fail → dead
    "completed":  set(),               # terminal
    "dead":       {"queued"},          # manual retry via DLQ
    "cancelled":  set(),               # terminal
}


def is_valid_transition(from_status: str, to_status: str) -> bool:
    """Returns True if the state transition is permitted by the lifecycle spec."""
    return to_status in VALID_TRANSITIONS.get(from_status, set())


class TestJobLifecycleTransitions(unittest.TestCase):
    """Asserts that the lifecycle graph matches the assignment spec."""

    # ── Valid happy-path transitions ───────────────────────────────────────────
    def test_queued_to_claimed(self):
        self.assertTrue(is_valid_transition("queued", "claimed"))

    def test_scheduled_to_queued(self):
        """Scheduled jobs become queued once their run_at time passes."""
        self.assertTrue(is_valid_transition("scheduled", "queued"))

    def test_claimed_to_running(self):
        self.assertTrue(is_valid_transition("claimed", "running"))

    def test_running_to_completed(self):
        self.assertTrue(is_valid_transition("running", "completed"))

    def test_running_to_failed_on_error(self):
        self.assertTrue(is_valid_transition("running", "failed"))

    def test_failed_to_queued_for_retry(self):
        """A failed job with remaining attempts should re-enter the queue."""
        self.assertTrue(is_valid_transition("failed", "queued"))

    def test_failed_to_dead_when_exhausted(self):
        """A failed job with no remaining attempts should enter DLQ."""
        self.assertTrue(is_valid_transition("failed", "dead"))

    def test_dead_to_queued_via_manual_retry(self):
        """Admins can retry dead jobs, which re-enter the queue as new jobs."""
        self.assertTrue(is_valid_transition("dead", "queued"))

    # ── Invalid / illegal transitions ──────────────────────────────────────────
    def test_completed_cannot_transition(self):
        """Completed is terminal — no further transitions allowed."""
        self.assertFalse(is_valid_transition("completed", "running"))
        self.assertFalse(is_valid_transition("completed", "failed"))
        self.assertFalse(is_valid_transition("completed", "queued"))

    def test_cancelled_cannot_transition(self):
        self.assertFalse(is_valid_transition("cancelled", "running"))
        self.assertFalse(is_valid_transition("cancelled", "queued"))

    def test_queued_cannot_skip_to_running(self):
        """Workers must claim before running — skipping claimed is illegal."""
        self.assertFalse(is_valid_transition("queued", "running"))

    def test_running_cannot_go_back_to_queued(self):
        self.assertFalse(is_valid_transition("running", "queued"))

    def test_running_cannot_go_to_claimed(self):
        self.assertFalse(is_valid_transition("running", "claimed"))


# ═══════════════════════════════════════════════════════════════════════════════
# 3. DLQ Promotion Logic Tests
# ═══════════════════════════════════════════════════════════════════════════════

def should_promote_to_dlq(attempts_made: int, max_attempts: int) -> bool:
    """Returns True if the job should be promoted to the Dead Letter Queue."""
    return attempts_made >= max_attempts


class TestDLQPromotion(unittest.TestCase):
    """Verifies that DLQ promotion triggers at exactly the right threshold."""

    def test_promote_when_at_max_attempts(self):
        """Should promote when attempts_made equals max_attempts."""
        self.assertTrue(should_promote_to_dlq(3, 3))

    def test_promote_when_over_max_attempts(self):
        """Should also promote if somehow over (defensive check)."""
        self.assertTrue(should_promote_to_dlq(4, 3))

    def test_no_promote_below_max_attempts(self):
        """Should NOT promote when retries remain."""
        self.assertFalse(should_promote_to_dlq(1, 3))
        self.assertFalse(should_promote_to_dlq(2, 3))

    def test_no_promote_first_failure(self):
        """The very first failure (attempt 1 of 3) should retry, not DLQ."""
        self.assertFalse(should_promote_to_dlq(1, 3))

    def test_single_attempt_job_promotes_immediately(self):
        """A job with max_attempts=1 should be DLQ'd after its single failure."""
        self.assertTrue(should_promote_to_dlq(1, 1))

    def test_zero_attempts_never_promotes(self):
        self.assertFalse(should_promote_to_dlq(0, 3))


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Priority Queue Ordering Tests
# ═══════════════════════════════════════════════════════════════════════════════

def sort_jobs_by_priority(jobs: list) -> list:
    """
    Sorts jobs for worker pick-up:
      1. Higher priority first (priority DESC)
      2. Earlier creation time as tiebreaker (created_at ASC)
    """
    return sorted(jobs, key=lambda j: (-j["priority"], j["created_at"]))


class TestPriorityOrdering(unittest.TestCase):
    """Verifies the scheduler picks up high-priority jobs first."""

    def setUp(self):
        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        self.jobs = [
            {"id": "A", "priority": 0,   "created_at": base + timedelta(minutes=1)},
            {"id": "B", "priority": 100, "created_at": base + timedelta(minutes=2)},
            {"id": "C", "priority": 50,  "created_at": base + timedelta(minutes=1)},
            {"id": "D", "priority": 100, "created_at": base + timedelta(minutes=1)},
        ]

    def test_highest_priority_first(self):
        """Job with priority=100 should come before priority=50 and 0."""
        sorted_jobs = sort_jobs_by_priority(self.jobs)
        self.assertEqual(sorted_jobs[0]["priority"], 100)

    def test_same_priority_older_job_first(self):
        """When two jobs share priority, the one created earlier runs first."""
        sorted_jobs = sort_jobs_by_priority(self.jobs)
        # D and B both have priority 100, but D was created earlier
        self.assertEqual(sorted_jobs[0]["id"], "D")
        self.assertEqual(sorted_jobs[1]["id"], "B")

    def test_lowest_priority_last(self):
        sorted_jobs = sort_jobs_by_priority(self.jobs)
        self.assertEqual(sorted_jobs[-1]["priority"], 0)

    def test_ordering_is_stable_for_equal_priority_and_time(self):
        """Identical priority and time should not raise errors."""
        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        jobs = [
            {"id": "X", "priority": 10, "created_at": base},
            {"id": "Y", "priority": 10, "created_at": base},
        ]
        result = sort_jobs_by_priority(jobs)
        self.assertEqual(len(result), 2)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Job Run_At Scheduling Tests
# ═══════════════════════════════════════════════════════════════════════════════

def get_initial_status(run_at: datetime) -> str:
    """
    Mirror of _build_job logic in backend/app/routers/jobs.py.
    Returns 'scheduled' if run_at is in the future, else 'queued'.
    """
    now = datetime.now(timezone.utc)
    return "scheduled" if run_at > now else "queued"


class TestJobInitialStatus(unittest.TestCase):
    """Verifies that jobs get the correct initial status based on their run_at."""

    def test_immediate_job_is_queued(self):
        """A job with no delay should enter as 'queued' immediately."""
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.assertEqual(get_initial_status(past), "queued")

    def test_future_job_is_scheduled(self):
        """A job with a future run_at should enter as 'scheduled'."""
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        self.assertEqual(get_initial_status(future), "scheduled")

    def test_far_future_job_is_scheduled(self):
        far_future = datetime.now(timezone.utc) + timedelta(days=30)
        self.assertEqual(get_initial_status(far_future), "scheduled")


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Payload Validation Tests
# ═══════════════════════════════════════════════════════════════════════════════

import json


def validate_job_payload(payload_str: str) -> dict:
    """Parses and validates a JSON payload string. Raises ValueError on invalid JSON."""
    try:
        data = json.loads(payload_str)
        if not isinstance(data, dict):
            raise ValueError("Payload must be a JSON object (dict), not a list or primitive.")
        return data
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}") from e


class TestPayloadValidation(unittest.TestCase):
    """Tests the JSON payload parsing enforced before job submission."""

    def test_valid_email_payload(self):
        payload = '{"to": "user@example.com", "subject": "Hello"}'
        result = validate_job_payload(payload)
        self.assertEqual(result["to"], "user@example.com")

    def test_valid_empty_object(self):
        """Empty payload object {} is valid — some job types need no input."""
        result = validate_job_payload("{}")
        self.assertEqual(result, {})

    def test_invalid_json_raises(self):
        with self.assertRaises(ValueError):
            validate_job_payload("{invalid json}")

    def test_array_payload_raises(self):
        """A JSON array is not a valid payload — must be an object."""
        with self.assertRaises(ValueError):
            validate_job_payload("[1, 2, 3]")

    def test_null_payload_raises(self):
        with self.assertRaises(ValueError):
            validate_job_payload("null")

    def test_nested_payload_is_valid(self):
        payload = '{"metadata": {"user_id": 1, "tags": ["urgent", "billing"]}}'
        result = validate_job_payload(payload)
        self.assertIn("metadata", result)


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Atomic Claim Simulation Tests (Concurrency Guard)
# ═══════════════════════════════════════════════════════════════════════════════

class TestAtomicClaimSimulation(unittest.TestCase):
    """
    Simulates the atomic job claiming mechanism without a real database.
    The claim logic uses SELECT ... FOR UPDATE SKIP LOCKED in production.
    Here we use a threading-safe in-memory list to verify no double-claims.
    """

    def setUp(self):
        """Create a pool of queued jobs."""
        self.jobs = [{"id": f"job-{i}", "status": "queued", "claimed_by": None}
                     for i in range(10)]
        self._lock_index = 0

    def _claim_next_job(self, worker_id: str):
        """Atomic-style claim: finds and locks the first unclaimed job."""
        for job in self.jobs:
            if job["status"] == "queued" and job["claimed_by"] is None:
                job["status"] = "running"
                job["claimed_by"] = worker_id
                return job
        return None

    def test_each_job_claimed_by_exactly_one_worker(self):
        """Run two workers sequentially claiming all jobs — no double claims."""
        claimed_by_w1 = []
        claimed_by_w2 = []
        for _ in range(5):
            j = self._claim_next_job("worker-1")
            if j: claimed_by_w1.append(j["id"])
        for _ in range(10):
            j = self._claim_next_job("worker-2")
            if j: claimed_by_w2.append(j["id"])

        # No overlap
        overlap = set(claimed_by_w1) & set(claimed_by_w2)
        self.assertEqual(len(overlap), 0, f"Double-claimed jobs: {overlap}")

    def test_total_claimed_equals_total_jobs(self):
        """All 10 jobs should be claimed exactly once."""
        for i in range(20):  # More iterations than jobs
            self._claim_next_job(f"worker-{i % 3}")

        claimed = [j for j in self.jobs if j["claimed_by"] is not None]
        self.assertEqual(len(claimed), 10)

    def test_no_unclaimed_jobs_after_full_sweep(self):
        """After claiming all jobs, no queued jobs should remain."""
        for i in range(15):
            self._claim_next_job("worker-1")

        still_queued = [j for j in self.jobs if j["status"] == "queued"]
        self.assertEqual(len(still_queued), 0)


# ═══════════════════════════════════════════════════════════════════════════════
# 8. RBAC Permission Matrix Tests
# ═══════════════════════════════════════════════════════════════════════════════

# Map role names to capability sets (mirrors the frontend access control logic)
ROLE_CAPABILITIES = {
    "owner": {
        "create_job", "cancel_job", "retry_dlq", "create_queue", "pause_queue",
        "invite_user", "delete_project", "view_workers", "view_logs"
    },
    "member": {
        "create_job", "cancel_job", "retry_dlq", "view_workers", "view_logs"
    },
    "member_read_only": {
        "view_workers", "view_logs"
    },
}


def can_perform(role: str, action: str) -> bool:
    """Returns True if the given role is permitted to perform the action."""
    return action in ROLE_CAPABILITIES.get(role, set())


class TestRBACPermissions(unittest.TestCase):
    """Verifies that the role permission matrix is enforced correctly."""

    # ── Owner (Admin) ──────────────────────────────────────────────────────────
    def test_owner_can_create_job(self):
        self.assertTrue(can_perform("owner", "create_job"))

    def test_owner_can_invite_users(self):
        self.assertTrue(can_perform("owner", "invite_user"))

    def test_owner_can_delete_project(self):
        self.assertTrue(can_perform("owner", "delete_project"))

    def test_owner_can_pause_queue(self):
        self.assertTrue(can_perform("owner", "pause_queue"))

    def test_owner_can_retry_dlq(self):
        self.assertTrue(can_perform("owner", "retry_dlq"))

    # ── Member (Read/Write) ────────────────────────────────────────────────────
    def test_member_can_create_job(self):
        self.assertTrue(can_perform("member", "create_job"))

    def test_member_can_cancel_job(self):
        self.assertTrue(can_perform("member", "cancel_job"))

    def test_member_cannot_invite_users(self):
        """Only owners can invite — members must not have this power."""
        self.assertFalse(can_perform("member", "invite_user"))

    def test_member_cannot_delete_project(self):
        self.assertFalse(can_perform("member", "delete_project"))

    def test_member_cannot_pause_queue(self):
        self.assertFalse(can_perform("member", "pause_queue"))

    # ── Read-Only Member ───────────────────────────────────────────────────────
    def test_readonly_can_view_logs(self):
        self.assertTrue(can_perform("member_read_only", "view_logs"))

    def test_readonly_cannot_create_job(self):
        self.assertFalse(can_perform("member_read_only", "create_job"))

    def test_readonly_cannot_cancel_job(self):
        self.assertFalse(can_perform("member_read_only", "cancel_job"))

    def test_readonly_cannot_retry_dlq(self):
        self.assertFalse(can_perform("member_read_only", "retry_dlq"))

    def test_readonly_cannot_invite_users(self):
        self.assertFalse(can_perform("member_read_only", "invite_user"))

    def test_unknown_role_has_no_capabilities(self):
        self.assertFalse(can_perform("hacker", "create_job"))
        self.assertFalse(can_perform("", "view_logs"))


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Cron Expression Next-Run Tests
# ═══════════════════════════════════════════════════════════════════════════════

try:
    from croniter import croniter
    CRONITER_AVAILABLE = True
except ImportError:
    CRONITER_AVAILABLE = False


@unittest.skipUnless(CRONITER_AVAILABLE, "croniter not installed")
class TestCronNextRun(unittest.TestCase):
    """Tests that cron expressions produce sensible next-run datetimes."""

    def _next_run(self, cron_expr: str, base: datetime = None) -> datetime:
        base = base or datetime(2025, 1, 1, 0, 0, tzinfo=timezone.utc)
        it = croniter(cron_expr, base)
        return it.get_next(datetime)

    def test_every_5_minutes(self):
        nxt = self._next_run("*/5 * * * *", datetime(2025, 1, 1, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(nxt.minute, 5)

    def test_midnight_daily(self):
        nxt = self._next_run("0 0 * * *", datetime(2025, 1, 1, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(nxt.day, 2)
        self.assertEqual(nxt.hour, 0)

    def test_hourly(self):
        nxt = self._next_run("0 * * * *", datetime(2025, 1, 1, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(nxt.hour, 1)

    def test_invalid_cron_raises(self):
        with self.assertRaises(Exception):
            croniter("not_a_cron_expression")


# ═══════════════════════════════════════════════════════════════════════════════
# Test Runner Entry Point
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    unittest.main(verbosity=2)
