import asyncio
import httpx

API_BASE = "http://localhost:8000/api/v1"
EMAIL = "admin@example.com"
PASSWORD = "password123"


async def main():
    # 1. Login to get token
    async with httpx.AsyncClient() as client:
        print("Logging in...")
        res = await client.post(
            f"{API_BASE}/auth/login",
            json={"email": EMAIL, "password": PASSWORD},
        )
        if res.status_code != 200:
            print("Login failed:", res.text)
            return
        token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Get organizations & projects
        print("Fetching orgs...")
        res = await client.get(f"{API_BASE}/orgs", headers=headers)
        org_id = res.json()["items"][0]["id"]

        print("Fetching projects...")
        res = await client.get(f"{API_BASE}/orgs/{org_id}/projects", headers=headers)
        project_id = res.json()["items"][0]["id"]

        print("Fetching queues...")
        res = await client.get(
            f"{API_BASE}/orgs/{org_id}/projects/{project_id}/queues",
            headers=headers,
        )
        queues = res.json()["items"]
        default_queue = next(q for q in queues if q["slug"] == "default")
        queue_id = default_queue["id"]

        # 3. Create a failing job
        print("Submitting failing job 'always_fail'...")
        job_payload = {
            "job_type": "always_fail",
            "payload": {"reason": "Testing the Groq API integration"},
            "priority": 10,
            "max_attempts": 2,
        }
        res = await client.post(
            f"{API_BASE}/queues/{queue_id}/jobs",
            headers=headers,
            json=job_payload,
        )
        if res.status_code != 201:
            print("Job submission failed:", res.text)
            return
        job = res.json()
        job_id = job["id"]
        print(f"Submitted job ID: {job_id}")

        # 4. Wait for worker to run attempts and promote to DLQ
        print("Waiting 45 seconds for worker attempts and DLQ promotion...")
        await asyncio.sleep(45.0)

        # 5. Fetch DLQ entries to see summary
        print("Fetching DLQ log...")
        res = await client.get(
            f"{API_BASE}/dlq/queues/{queue_id}/dlq", headers=headers
        )
        print("DLQ Status:", res.status_code)
        print("DLQ Response:", res.json())
        dlq_entries = res.json()["items"]
        target = next((e for e in dlq_entries if e["job_id"] == job_id), None)
        if not target:
            print("Could not find job in DLQ!")
            return

        print("\n=== Dead Letter Queue Entry ===")
        print("Job ID:", target["job_id"])
        print("Job Type:", target["job_type"])
        print("Failure Reason:", target["failure_reason"])
        print("AI Summary:", target["ai_failure_summary"])
        print("Generated At:", target["ai_summary_generated_at"])
        print("===============================\n")


if __name__ == "__main__":
    asyncio.run(main())
