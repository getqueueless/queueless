"""Load test for issue_token/call_next concurrency + latency.

Run against a LOCAL stack first (see README.md). Creates N real patient
users via GoTrue's admin API (never a self-minted fake profile -- issue_token
needs a real auth.uid() that resolves through the on-auth.users-insert
trigger to a real profiles row), mints a session JWT for each with the same
JWT_SECRET PostgREST verifies against (the same round trip GoTrue's own
magic-link flow would produce, without an email hop), fires concurrent
issue_token calls at one service, then races 2 parallel call_next loops
against real counters and checks neither claimed the same token.

Every credential comes from the environment. Never hardcoded, never
committed -- see README.md's "Credentials" section for exactly what's
needed and why each one is safe to hold only in the environment.
"""

import asyncio
import json
import os
import sys
import time
import uuid

import httpx
import jwt

from stats import find_duplicates, summarize_latencies

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]
SERVICE_ID = os.environ["LOADTEST_SERVICE_ID"]
COUNTER_IDS = os.environ["LOADTEST_COUNTER_IDS"].split(",")  # need >=1, ideally 2

N_LOW = int(os.environ.get("LOADTEST_N_LOW", "200"))
N_HIGH = int(os.environ.get("LOADTEST_N_HIGH", "1000"))


def mint_jwt(user_id: str) -> str:
    """Same shape GoTrue itself issues -- signed with the same JWT_SECRET
    PostgREST verifies every request against. This is not a bypass: the
    user_id here is a real, just-created auth.users row (see
    create_test_patient below), so this is functionally identical to
    extracting a session token from GoTrue's own admin-generated magic
    link, without an email round trip."""
    payload = {
        "sub": user_id,
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def create_test_patient(client: httpx.AsyncClient, index: int) -> str:
    """POST /auth/v1/admin/users -- service-role only. Returns the new
    user's real id. Autoconfirmed so no OTP round trip is needed."""
    email = f"loadtest-patient-{uuid.uuid4().hex[:10]}-{index}@loadtest.invalid"
    resp = await client.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
        json={"email": email, "email_confirm": True},
    )
    resp.raise_for_status()
    return resp.json()["id"]


async def issue_token_once(client: httpx.AsyncClient, jwt_token: str) -> tuple[bool, float, dict | None]:
    started = time.monotonic()
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/issue_token",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {jwt_token}"},
        json={"p_service": SERVICE_ID},
    )
    latency_ms = (time.monotonic() - started) * 1000
    if resp.status_code == 200:
        body = resp.json()
        row = body[0] if isinstance(body, list) else body
        return True, latency_ms, row
    return False, latency_ms, None


async def run_issue_token_wave(jwts: list[str], concurrency_label: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        results = await asyncio.gather(*(issue_token_once(client, j) for j in jwts))

    successes = [r for r in results if r[0]]
    failures = [r for r in results if not r[0]]
    numbers = [r[2]["number"] for r in successes if r[2] and "number" in r[2]]
    dupes = find_duplicates(numbers)

    summary = summarize_latencies([r[1] for r in results])
    summary.update(
        {
            "wave": concurrency_label,
            "requested": len(jwts),
            "succeeded": len(successes),
            "failed": len(failures),
            "error_rate": round(len(failures) / len(jwts), 4) if jwts else 0.0,
            "duplicate_numbers": dupes,
        }
    )
    return summary


async def call_next_loop(client: httpx.AsyncClient, staff_jwt: str, counter_id: str, claimed: list, max_calls: int) -> None:
    for _ in range(max_calls):
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/call_next",
            headers={"apikey": ANON_KEY, "Authorization": f"Bearer {staff_jwt}"},
            json={"p_counter": counter_id},
        )
        if resp.status_code == 200:
            body = resp.json()
            rows = body if isinstance(body, list) else [body]
            for row in rows:
                if row and "id" in row:
                    claimed.append(row["id"])
        else:
            break  # counter_closed / empty queue / forbidden -- stop this loop


async def run_call_next_race(staff_jwt: str, max_calls_per_loop: int = 200) -> dict:
    """2 parallel loops against real counters (2 different desks if
    COUNTER_IDS has >=2 -- the real concurrency risk: two desks racing the
    same waiting queue must never both claim the same token, enforced by
    tokens_one_per_desk's unique index on counter_id). With only 1 counter
    configured, both loops hit it -- still a valid, if weaker, proof that a
    concurrent double-call on one desk never happens."""
    counter_a = COUNTER_IDS[0]
    counter_b = COUNTER_IDS[1] if len(COUNTER_IDS) > 1 else COUNTER_IDS[0]
    claimed_a: list = []
    claimed_b: list = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        await asyncio.gather(
            call_next_loop(client, staff_jwt, counter_a, claimed_a, max_calls_per_loop),
            call_next_loop(client, staff_jwt, counter_b, claimed_b, max_calls_per_loop),
        )

    all_claimed = claimed_a + claimed_b
    dupes = find_duplicates(all_claimed)
    return {
        "counter_a": counter_a,
        "counter_b": counter_b,
        "claimed_by_a": len(claimed_a),
        "claimed_by_b": len(claimed_b),
        "double_calls": dupes,
    }


async def main() -> int:
    staff_jwt = os.environ.get("LOADTEST_STAFF_JWT")
    if not staff_jwt:
        print("LOADTEST_STAFF_JWT not set -- skipping call_next race (needs a real staff/admin session)")

    report: dict = {"waves": []}

    async with httpx.AsyncClient(timeout=30.0) as client:
        print(f"Creating {N_HIGH} test patients via GoTrue admin API...")
        user_ids = await asyncio.gather(*(create_test_patient(client, i) for i in range(N_HIGH)))
    jwts = [mint_jwt(uid) for uid in user_ids]

    for n, label in ((N_LOW, f"{N_LOW}_concurrent"), (N_HIGH, f"{N_HIGH}_concurrent")):
        print(f"Firing {n} concurrent issue_token calls...")
        wave = await run_issue_token_wave(jwts[:n], label)
        report["waves"].append(wave)
        print(json.dumps(wave, indent=2))

    if staff_jwt:
        print("Racing 2 parallel call_next loops...")
        race = await run_call_next_race(staff_jwt)
        report["call_next_race"] = race
        print(json.dumps(race, indent=2))

    print("\n=== FINAL REPORT ===")
    print(json.dumps(report, indent=2))

    ok = True
    for wave in report["waves"]:
        if wave["duplicate_numbers"]:
            print(f"FAIL: duplicate token numbers in {wave['wave']}: {wave['duplicate_numbers']}")
            ok = False
    if report.get("call_next_race", {}).get("double_calls"):
        print(f"FAIL: double-called tokens: {report['call_next_race']['double_calls']}")
        ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
