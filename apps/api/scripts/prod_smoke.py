"""Smoke test against the real production deployment (https://api.lpu.lol
by default). Fires real HTTP requests at every route and asserts the real
response -- never just documents intent.

Logins are read at runtime from ~/code/queueless-qa/.env.qa (email/password
pairs only -- SUPABASE_URL and SUPABASE_ANON_KEY are separate env vars, the
same convention loadtest/load_test.py uses). Never logged, never committed:
_load_qa_env returns a dict a caller pulls one key from, this module never
prints or serializes the whole thing.

Kept read-only wherever a real check doesn't need a write: /admin/summary
(GET) is checked instead of POST /admin/summary/run, since the POST re-runs
a real, spend-metered DeepSeek call even for an already-summarized day --
not something a routine smoke test should trigger on a shared VPS.
/admin/ask and /translate do each make one real DeepSeek call apiece (the
task asks for them explicitly, and each is a single bounded call, not a
loop).

Usage:
    SUPABASE_URL=https://sb.lpu.lol SUPABASE_ANON_KEY=... \\
        uv run python scripts/prod_smoke.py
"""

import asyncio
import os
import sys
import time
from pathlib import Path

import httpx

API_URL = os.environ.get("API_URL", "https://api.lpu.lol").rstrip("/")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://sb.lpu.lol").rstrip("/")
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
QA_ENV_PATH = Path(os.environ.get("QA_ENV_PATH", str(Path.home() / "code/queueless-qa/.env.qa")))


def _load_qa_env(path: Path) -> dict:
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


async def sign_in(client: httpx.AsyncClient, email: str, password: str) -> str:
    resp = await client.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON_KEY},
        json={"email": email, "password": password},
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


class Results:
    def __init__(self) -> None:
        self.failures: list[str] = []

    async def check(self, name: str, coro) -> None:
        started = time.monotonic()
        try:
            await coro
        except Exception as exc:  # noqa: BLE001 - a smoke test must keep going past one bad check
            elapsed = (time.monotonic() - started) * 1000
            self.failures.append(name)
            print(f"FAIL  {name} ({elapsed:.0f}ms): {exc}")
        else:
            elapsed = (time.monotonic() - started) * 1000
            print(f"PASS  {name} ({elapsed:.0f}ms)")


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def check_health(client: httpx.AsyncClient) -> None:
    resp = await client.get(f"{API_URL}/health")
    _assert(resp.status_code == 200, f"status {resp.status_code}")
    _assert(resp.json().get("status") == "ok", f"body {resp.text}")


async def check_ready(client: httpx.AsyncClient) -> None:
    resp = await client.get(f"{API_URL}/ready")
    _assert(resp.status_code == 200, f"status {resp.status_code}: {resp.text}")
    _assert(resp.json().get("status") == "ready", f"body {resp.text}")


async def check_metrics(client: httpx.AsyncClient) -> None:
    resp = await client.get(f"{API_URL}/metrics")
    _assert(resp.status_code == 200, f"status {resp.status_code}")
    _assert("http_requests_total" in resp.text, "http_requests_total missing from /metrics")


async def check_predict(client: httpx.AsyncClient) -> None:
    # A real service_id, fetched live -- board_services is publicly
    # readable (supabase/migrations/0030), so this needs no auth and no
    # hardcoded demo UUID that would go stale.
    rows = await client.get(
        f"{SUPABASE_URL}/rest/v1/board_services",
        headers={"apikey": SUPABASE_ANON_KEY},
        params={"select": "service_id", "limit": "1"},
    )
    rows.raise_for_status()
    services = rows.json()
    _assert(services, "board_services returned no rows to predict against")
    service_id = services[0]["service_id"]

    resp = await client.post(
        f"{API_URL}/predict",
        json={
            "service_id": service_id,
            "hour": 10,
            "weekday": 2,
            "queue_len_ahead": 3,
            "counters_open": 2,
        },
    )
    _assert(resp.status_code == 200, f"status {resp.status_code}: {resp.text}")
    _assert("predicted_wait_minutes" in resp.json(), f"body {resp.text}")


async def check_staff_insights(client: httpx.AsyncClient, qa_env: dict) -> None:
    jwt_token = await sign_in(client, qa_env["COUNTER1_EMAIL"], qa_env["COUNTER1_PASSWORD"])
    resp = await client.get(
        f"{API_URL}/staff/insights", headers={"Authorization": f"Bearer {jwt_token}"}
    )
    _assert(resp.status_code == 200, f"status {resp.status_code}: {resp.text}")
    _assert("org_id" in resp.json(), f"body {resp.text}")


async def check_admin_model(client: httpx.AsyncClient, admin_jwt: str) -> None:
    resp = await client.get(
        f"{API_URL}/admin/model", headers={"Authorization": f"Bearer {admin_jwt}"}
    )
    _assert(resp.status_code == 200, f"status {resp.status_code}: {resp.text}")
    _assert("version" in resp.json(), f"body {resp.text}")


async def check_admin_ask(client: httpx.AsyncClient, admin_jwt: str) -> None:
    resp = await client.post(
        f"{API_URL}/admin/ask",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"question": "How many patients are waiting right now?"},
    )
    _assert(resp.status_code == 200, f"status {resp.status_code}: {resp.text}")


async def check_translate(client: httpx.AsyncClient, admin_jwt: str, target_lang: str) -> None:
    resp = await client.post(
        f"{API_URL}/translate",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"text": "Your token has been called.", "target_lang": target_lang},
    )
    _assert(resp.status_code == 200, f"status {resp.status_code}: {resp.text}")
    _assert(resp.json().get("translated"), f"body {resp.text}")


async def check_daily_summary(client: httpx.AsyncClient, admin_jwt: str) -> None:
    # GET, not POST /admin/summary/run -- see module docstring.
    resp = await client.get(
        f"{API_URL}/admin/summary", headers={"Authorization": f"Bearer {admin_jwt}"}
    )
    _assert(resp.status_code in (200, 404), f"status {resp.status_code}: {resp.text}")


async def check_payments_webhook_rejects_bad_signature(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        f"{API_URL}/payments/razorpay/webhook",
        headers={"x-razorpay-signature": "not-a-real-signature"},
        content=b'{"event": "payment.captured"}',
    )
    _assert(resp.status_code == 401, f"status {resp.status_code}: {resp.text}")


async def main() -> int:
    qa_env = _load_qa_env(QA_ENV_PATH)
    results = Results()

    async with httpx.AsyncClient(timeout=30.0) as client:
        await results.check("GET /health", check_health(client))
        await results.check("GET /ready", check_ready(client))
        await results.check("GET /metrics", check_metrics(client))
        await results.check("POST /predict", check_predict(client))
        await results.check("GET /staff/insights", check_staff_insights(client, qa_env))
        await results.check(
            "POST /payments/razorpay/webhook (bad signature)",
            check_payments_webhook_rejects_bad_signature(client),
        )

        try:
            admin_jwt = await sign_in(client, qa_env["ADMIN_EMAIL"], qa_env["ADMIN_PASSWORD"])
        except Exception as exc:  # noqa: BLE001 - report as one failed check, not a crash
            results.failures.append("admin sign-in")
            print(f"FAIL  admin sign-in: {exc}")
        else:
            await results.check("GET /admin/model", check_admin_model(client, admin_jwt))
            await results.check("POST /admin/ask", check_admin_ask(client, admin_jwt))
            await results.check("POST /translate (hi)", check_translate(client, admin_jwt, "hi"))
            await results.check("POST /translate (pa)", check_translate(client, admin_jwt, "pa"))
            await results.check("GET /admin/summary", check_daily_summary(client, admin_jwt))

    print()
    if results.failures:
        print(f"{len(results.failures)} check(s) failed: {', '.join(results.failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
