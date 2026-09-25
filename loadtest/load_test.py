"""Load test for issue_token/call_next concurrency + latency.

Runs entirely against its own throwaway org (`loadtest-org`), created by
this script and torn down at the end (or on any failure -- see main()'s
try/finally) -- it never touches the demo org's live queue or any real
patient's waiting token. Creates N real patient users via GoTrue's admin
API (never a self-minted fake profile -- issue_token needs a real
auth.uid() that resolves through the on-auth.users-insert trigger to a
real profiles row), completes each one's profile via the real
complete_my_profile RPC (issue_token 403s with profile_incomplete since
migration 0037 otherwise -- confirmed issue_token sends no SMS or any
other real-world side effect before using fake +91 numbers here), mints a
session JWT for each with the same JWT_SECRET PostgREST verifies against
(the same round trip GoTrue's own magic-link flow would produce, without
an email hop), fires concurrent issue_token calls at the loadtest
service, then races 2 parallel call_next loops against the loadtest
org's own 2 counters and checks neither claimed the same token. The
200-wave and the 1000-wave each use their own disjoint slice of patients
-- reusing one across waves hits issue_token's real `already_active` 409
(a patient can hold only one active ticket per service), not a load-test
bug.

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

N_LOW = int(os.environ.get("LOADTEST_N_LOW", "200"))
N_HIGH = int(os.environ.get("LOADTEST_N_HIGH", "1000"))

ORG_SLUG = "loadtest-org"
SERVICE_HEADERS = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}


def mint_jwt(user_id: str) -> str:
    """Same shape GoTrue itself issues -- signed with the same JWT_SECRET
    PostgREST verifies every request against. This is not a bypass: the
    user_id here is a real, just-created auth.users row, so this is
    functionally identical to extracting a session token from GoTrue's own
    admin-generated magic link, without an email round trip."""
    payload = {
        "sub": user_id,
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def create_test_user(client: httpx.AsyncClient, label: str, index: int) -> str:
    """POST /auth/v1/admin/users -- service-role only. Returns the new
    user's real id. Autoconfirmed so no OTP round trip is needed. Every
    created email shares the @loadtest.invalid domain -- README.md's
    cleanup command matches on exactly that."""
    email = f"loadtest-{label}-{uuid.uuid4().hex[:10]}-{index}@loadtest.invalid"
    resp = await client.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=SERVICE_HEADERS,
        json={"email": email, "email_confirm": True},
    )
    resp.raise_for_status()
    return resp.json()["id"]


async def delete_org_and_dependents(client: httpx.AsyncClient, org_id: str) -> None:
    """organizations -> tokens cascades (on delete cascade), but tokens ->
    notifications does NOT (no cascade on notifications_token_id_fkey) --
    found live: deleting the org directly 409s with a FK violation the
    moment any token in it has a notification. Clear those first."""
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/tokens", headers=SERVICE_HEADERS,
        params={"select": "id", "org_id": f"eq.{org_id}"},
    )
    resp.raise_for_status()
    token_ids = [row["id"] for row in resp.json()]
    if token_ids:
        resp = await client.delete(
            f"{SUPABASE_URL}/rest/v1/notifications", headers=SERVICE_HEADERS,
            params={"token_id": f"in.({','.join(token_ids)})"},
        )
        if resp.status_code >= 400:
            print(f"WARNING: notifications cleanup got {resp.status_code}: {resp.text[:200]}")

    resp = await client.delete(
        f"{SUPABASE_URL}/rest/v1/organizations", headers=SERVICE_HEADERS, params={"id": f"eq.{org_id}"},
    )
    if resp.status_code >= 400:
        print(f"WARNING: org cleanup got {resp.status_code}: {resp.text[:200]}")


async def delete_org_if_exists(client: httpx.AsyncClient) -> None:
    """Idempotent: a crashed prior run can leave `loadtest-org` behind --
    delete it first so this run starts clean. Cascades to services/
    counters/counter_services/tokens (all `on delete cascade` from
    organizations), but NOT to auth.users -- those are cleaned up
    separately, see cleanup() below."""
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/organizations", headers=SERVICE_HEADERS,
        params={"select": "id", "slug": f"eq.{ORG_SLUG}"},
    )
    resp.raise_for_status()
    rows = resp.json()
    if rows:
        await delete_org_and_dependents(client, rows[0]["id"])


async def create_org(client: httpx.AsyncClient) -> str:
    await delete_org_if_exists(client)
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/organizations",
        headers={**SERVICE_HEADERS, "Prefer": "return=representation"},
        json={"slug": ORG_SLUG, "name": "Load Test Org"},
    )
    resp.raise_for_status()
    return resp.json()[0]["id"]


async def create_service(client: httpx.AsyncClient, org_id: str) -> str:
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/services",
        headers={**SERVICE_HEADERS, "Prefer": "return=representation"},
        json={"org_id": org_id, "code": "LT1", "name": "Load Test Service"},  # is_open defaults true
    )
    resp.raise_for_status()
    return resp.json()[0]["id"]


async def create_counters(client: httpx.AsyncClient, org_id: str, service_id: str) -> list[str]:
    """2 counters, state='open' explicitly (the column defaults to
    'closed' -- call_next 409s with counter_closed otherwise), each linked
    to the loadtest service via counter_services -- call_next's own queue
    query joins through that table, not a direct counter->service column."""
    counter_ids = []
    for i in range(2):
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/counters",
            headers={**SERVICE_HEADERS, "Prefer": "return=representation"},
            json={"org_id": org_id, "name": f"Load Test Desk {i + 1}", "state": "open"},
        )
        resp.raise_for_status()
        counter_ids.append(resp.json()[0]["id"])
    for counter_id in counter_ids:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/counter_services",
            headers=SERVICE_HEADERS,
            json={"counter_id": counter_id, "service_id": service_id},
        )
        resp.raise_for_status()
    return counter_ids


async def create_staff(client: httpx.AsyncClient, org_id: str) -> tuple[str, str]:
    """A real staff profile scoped to the loadtest org -- call_next checks
    `profiles.org_id = counters.org_id and role in ('staff','admin')`, so
    this can't be a stranger to the org the way the auth-only checks
    elsewhere in this codebase use one. profiles.role/org_id default to
    'patient'/null on signup (private.handle_new_user); PATCH them
    directly via the service role, which bypasses RLS same as every other
    write in this script."""
    user_id = await create_test_user(client, "staff", 0)
    resp = await client.patch(
        f"{SUPABASE_URL}/rest/v1/profiles", headers=SERVICE_HEADERS,
        params={"id": f"eq.{user_id}"}, json={"org_id": org_id, "role": "staff"},
    )
    resp.raise_for_status()
    return user_id, mint_jwt(user_id)


async def complete_profile(client: httpx.AsyncClient, jwt_token: str, index: int) -> None:
    # +91 6/7/8/9-prefixed 10-digit number, unique per patient, matching
    # profiles_phone_e164_in's real check constraint.
    phone = f"+91{6_000_000_000 + index}"
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/complete_my_profile",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {jwt_token}"},
        json={
            "p_full_name": f"Load Test Patient {index}",
            "p_phone": phone,
            "p_date_of_birth": "1990-01-01",
            "p_gender": "other",
            "p_city": "Load Test City",
        },
    )
    resp.raise_for_status()


async def issue_token_once(client: httpx.AsyncClient, jwt_token: str, service_id: str) -> tuple[bool, float, dict | None]:
    started = time.monotonic()
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/issue_token",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {jwt_token}"},
        json={"p_service": service_id},
    )
    latency_ms = (time.monotonic() - started) * 1000
    if resp.status_code == 200:
        body = resp.json()
        row = body[0] if isinstance(body, list) else body
        return True, latency_ms, row
    return False, latency_ms, None


async def run_issue_token_wave(jwts: list[str], service_id: str, concurrency_label: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        results = await asyncio.gather(*(issue_token_once(client, j, service_id) for j in jwts))

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


async def run_call_next_race(staff_jwt: str, counter_ids: list[str], max_calls_per_loop: int = 700) -> dict:
    """2 parallel loops against the loadtest org's own 2 desks -- the real
    concurrency risk: two desks racing the same waiting queue must never
    both claim the same token, enforced by tokens_one_per_desk's unique
    index on counter_id."""
    counter_a, counter_b = counter_ids[0], counter_ids[1]
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


async def cleanup(client: httpx.AsyncClient, org_id: str | None, user_ids: list[str]) -> None:
    """Order matters -- found live: profiles -> tokens has no cascade
    either (no cascade on tokens_patient_id_fkey), so deleting a patient's
    auth.users row while their token still exists 409s too. Org (and its
    notifications) must go first."""
    if org_id:
        await delete_org_and_dependents(client, org_id)

    for user_id in user_ids:
        resp = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=SERVICE_HEADERS,
        )
        if resp.status_code >= 400:
            print(f"WARNING: user cleanup for {user_id} got {resp.status_code}: {resp.text[:200]}")


async def main() -> int:
    total_patients = N_LOW + N_HIGH
    org_id = None
    all_user_ids: list[str] = []

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            print(f"Creating {ORG_SLUG} + service + 2 counters (isolated from the demo org)...")
            org_id = await create_org(client)
            service_id = await create_service(client, org_id)
            counter_ids = await create_counters(client, org_id, service_id)
            staff_id, staff_jwt = await create_staff(client, org_id)
            all_user_ids.append(staff_id)

            print(f"Creating {total_patients} test patients via GoTrue admin API...")
            patient_ids = await asyncio.gather(
                *(create_test_user(client, "patient", i) for i in range(total_patients))
            )
            all_user_ids.extend(patient_ids)
            jwts = [mint_jwt(uid) for uid in patient_ids]

            print(f"Completing {total_patients} patient profiles (real complete_my_profile RPC)...")
            await asyncio.gather(*(complete_profile(client, j, i) for i, j in enumerate(jwts)))

        report: dict = {"waves": []}
        # Disjoint slices -- reusing a patient across waves hits issue_token's
        # real already_active 409 (one active ticket per service), which is
        # correct RPC behavior, not something a load test should trip over.
        low_jwts, high_jwts = jwts[:N_LOW], jwts[N_LOW:N_LOW + N_HIGH]
        for wave_jwts, label in ((low_jwts, f"{N_LOW}_concurrent"), (high_jwts, f"{N_HIGH}_concurrent")):
            print(f"Firing {len(wave_jwts)} concurrent issue_token calls...")
            wave = await run_issue_token_wave(wave_jwts, service_id, label)
            report["waves"].append(wave)
            print(json.dumps(wave, indent=2))

        print("Racing 2 parallel call_next loops...")
        race = await run_call_next_race(staff_jwt, counter_ids, max_calls_per_loop=total_patients)
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
    finally:
        print(f"\nCleaning up {ORG_SLUG} and {len(all_user_ids)} test users...")
        async with httpx.AsyncClient(timeout=30.0) as client:
            await cleanup(client, org_id, all_user_ids)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
