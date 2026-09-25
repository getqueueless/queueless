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

import asyncpg
import httpx
import jwt

from stats import find_duplicates, summarize_latencies

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

WAVES = [int(x) for x in os.environ.get("LOADTEST_WAVES", "100,200,500,1000").split(",")]
# Setup (user creation + profile completion) isn't the measured part --
# found live against prod: firing 300 GoTrue admin/users POSTs at once
# exhausted GoTrue's own DB pool ("couldn't start a new transaction:
# context canceled", a 500). Bounded + retried; the measured issue_token/
# call_next phase below stays at full concurrency.
SETUP_CONCURRENCY = int(os.environ.get("LOADTEST_SETUP_CONCURRENCY", "8"))
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
# Early-stop thresholds -- no point burning through the rest of an
# escalating wave list once one wave already shows real trouble.
MAX_ERROR_RATE = 0.05
MAX_P95_MS = 10_000
MIN_RACE_WAITING = 50
# Extra patients created up front, beyond WAVES + the DB burst, purely as
# spare capacity for the pre-race top-up below (with no early stop and no
# setup failures, every created patient would otherwise already be spent
# by the time the race runs, leaving nothing to top up with).
RACE_TOP_UP_RESERVE = 150
# Optional: a raw-Postgres burst that proves DB-level concurrency
# correctness without Kong/PostgREST/GoTrue in the path at all. Skipped
# (with a clear note) if not set, same convention as every other optional
# piece in this script.
DATABASE_URL = os.environ.get("DATABASE_URL", "")
DB_BURST_SIZE = int(os.environ.get("LOADTEST_DB_BURST_SIZE", "1000"))
DB_BURST_POOL_SIZE = int(os.environ.get("LOADTEST_DB_BURST_POOL_SIZE", "20"))

# Unique per run, not a fixed "loadtest-org" -- found live: two runs against
# the same prod at once (this session verifying a fix while the orchestrator
# was mid-run) raced on delete-then-create, and one run's cleanup deleted
# the other's still-in-progress org. A random suffix means concurrent runs
# can never collide; a crashed run's org just sits under its own unique
# slug rather than confusing a later run's idempotent-start check.
ORG_SLUG = f"loadtest-org-{uuid.uuid4().hex[:8]}"
SERVICE_HEADERS = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}


async def _post_with_retry(client: httpx.AsyncClient, url: str, *, retries: int = 4, **kwargs) -> httpx.Response:
    """Setup-phase POSTs only -- retries a 429/5xx with linear backoff,
    never masks a real 4xx (those are real validation/auth failures, not
    transient capacity issues)."""
    resp = None
    for attempt in range(retries):
        resp = await client.post(url, **kwargs)
        if resp.status_code not in RETRYABLE_STATUSES:
            return resp
        await asyncio.sleep(0.5 * (attempt + 1))
    return resp


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


async def create_test_user(
    client: httpx.AsyncClient, label: str, index: int, semaphore: asyncio.Semaphore, created_ids: list
) -> str:
    """POST /auth/v1/admin/users -- service-role only. Returns the new
    user's real id. Autoconfirmed so no OTP round trip is needed. Every
    created email shares the @loadtest.invalid domain -- README.md's
    cleanup command matches on exactly that.

    Bounded by `semaphore` and retried on 429/5xx (setup isn't the
    measured phase -- found live: 300 of these at once exhausted GoTrue's
    own DB pool). Appends to `created_ids` the moment the id exists, not
    after this coroutine returns -- found live: a sibling task's raise_for_
    status() failure inside the same asyncio.gather() call loses every
    still-pending task's return value, so only tracking ids from gather's
    result silently drops already-created accounts from cleanup."""
    async with semaphore:
        email = f"loadtest-{label}-{uuid.uuid4().hex[:10]}-{index}@loadtest.invalid"
        resp = await _post_with_retry(
            client, f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=SERVICE_HEADERS, json={"email": email, "email_confirm": True},
        )
        resp.raise_for_status()
        user_id = resp.json()["id"]
        created_ids.append(user_id)
        return user_id


CLEANUP_CHUNK_SIZE = 50


async def _chunked_delete(client: httpx.AsyncClient, table: str, column: str, values: list[str], label: str) -> None:
    """Deletes `WHERE column IN (values)` in chunks -- found live at real
    scale (300+ tokens): a single `in.(...)` filter with hundreds of UUIDs
    makes a URL long enough for Kong/PostgREST to reject it, the delete
    silently 400s, and every downstream step (the org cascade, then every
    user delete) fails on the FK this was supposed to clear first."""
    for i in range(0, len(values), CLEANUP_CHUNK_SIZE):
        chunk = values[i:i + CLEANUP_CHUNK_SIZE]
        resp = await client.delete(
            f"{SUPABASE_URL}/rest/v1/{table}", headers=SERVICE_HEADERS,
            params={column: f"in.({','.join(chunk)})"},
        )
        if resp.status_code >= 400:
            print(f"WARNING: {label} cleanup (chunk {i // CLEANUP_CHUNK_SIZE}) got {resp.status_code}: {resp.text[:200]}")


async def delete_org_and_dependents(client: httpx.AsyncClient, org_id: str) -> None:
    """organizations -> tokens cascades (on delete cascade), but tokens ->
    notifications does NOT (no cascade on notifications_token_id_fkey) --
    found live: deleting the org directly 409s with a FK violation the
    moment any token in it has a notification. Clear those first, in
    chunks (see _chunked_delete). Order matches what actually worked
    against a real 300-token/300-user prod run, not just the org-cascade
    theory: notifications -> tokens (explicit, not just relying on the
    org cascade to reach them) -> profiles (org_id set null by the org
    cascade, not deleted -- explicit delete here means auth.users deletes
    below never hit a leftover profile->tokens block) -> the org itself
    (services/counters/counter_services/board_* all cascade from it)."""
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/tokens", headers=SERVICE_HEADERS,
        params={"select": "id,patient_id", "org_id": f"eq.{org_id}"},
    )
    resp.raise_for_status()
    rows = resp.json()
    token_ids = [row["id"] for row in rows]
    patient_ids = [row["patient_id"] for row in rows if row.get("patient_id")]

    if token_ids:
        await _chunked_delete(client, "notifications", "token_id", token_ids, "notifications")
        await _chunked_delete(client, "tokens", "id", token_ids, "tokens")
    if patient_ids:
        await _chunked_delete(client, "profiles", "id", patient_ids, "profiles")

    resp = await client.delete(
        f"{SUPABASE_URL}/rest/v1/organizations", headers=SERVICE_HEADERS, params={"id": f"eq.{org_id}"},
    )
    if resp.status_code >= 400:
        print(f"WARNING: org cleanup got {resp.status_code}: {resp.text[:200]}")


async def create_org(client: httpx.AsyncClient) -> str:
    # No pre-delete-if-exists step -- ORG_SLUG is unique per run now, so
    # there is nothing stale to clean up under this exact slug, and (this
    # is the real reason it was removed) nothing to accidentally delete
    # out from under a concurrently-running other instance of this script.
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
        json={
            "org_id": org_id, "code": "LT1", "name": "Load Test Service",
            # services.max_tokens_per_day defaults to 500 (supabase/migrations/
            # 0003) -- issue_token's own private.mint_token 409s with
            # queue_full past that, and every wave targets the SAME service
            # (cumulative numbering across waves, not reset per wave), so a
            # cumulative total past 500 would legitimately queue_full. Found
            # live: this is the prime suspect for a wave failing wholesale.
            "max_tokens_per_day": 100_000,
        },  # is_open defaults true
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


async def create_staff(client: httpx.AsyncClient, org_id: str, created_ids: list) -> tuple[str, str]:
    """A real staff profile scoped to the loadtest org -- call_next checks
    `profiles.org_id = counters.org_id and role in ('staff','admin')`, so
    this can't be a stranger to the org the way the auth-only checks
    elsewhere in this codebase use one. profiles.role/org_id default to
    'patient'/null on signup (private.handle_new_user); PATCH them
    directly via the service role, which bypasses RLS same as every other
    write in this script."""
    semaphore = asyncio.Semaphore(1)
    user_id = await create_test_user(client, "staff", 0, semaphore, created_ids)
    resp = await client.patch(
        f"{SUPABASE_URL}/rest/v1/profiles", headers=SERVICE_HEADERS,
        params={"id": f"eq.{user_id}"}, json={"org_id": org_id, "role": "staff"},
    )
    resp.raise_for_status()
    return user_id, mint_jwt(user_id)


async def complete_profile(client: httpx.AsyncClient, jwt_token: str, index: int, semaphore: asyncio.Semaphore) -> None:
    # +91 6/7/8/9-prefixed 10-digit number, unique per patient, matching
    # profiles_phone_e164_in's real check constraint.
    async with semaphore:
        phone = f"+91{6_000_000_000 + index}"
        resp = await _post_with_retry(
            client, f"{SUPABASE_URL}/rest/v1/rpc/complete_my_profile",
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


async def issue_token_once(client: httpx.AsyncClient, jwt_token: str, service_id: str) -> tuple[bool, float, dict | None, str | None]:
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
        return True, latency_ms, row, None
    return False, latency_ms, None, f"{resp.status_code}: {resp.text[:300]}"


def _first_distinct_errors(errors: list[str], limit: int = 3) -> list[str]:
    seen: list[str] = []
    for e in errors:
        if e not in seen:
            seen.append(e)
        if len(seen) >= limit:
            break
    return seen


async def run_issue_token_wave(jwts: list[str], service_id: str, concurrency_label: str) -> dict:
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=30.0) as client:
        results = await asyncio.gather(*(issue_token_once(client, j, service_id) for j in jwts))
    wall_seconds = time.monotonic() - started

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
            "tokens_per_sec": round(len(successes) / wall_seconds, 2) if wall_seconds > 0 else 0.0,
            # Debugging aid, not a metric -- found live: a wave failing
            # wholesale with no recorded reason is nearly impossible to
            # diagnose after the fact.
            "sample_errors": _first_distinct_errors([r[3] for r in failures if r[3]]),
        }
    )
    return summary


async def call_next_loop(client: httpx.AsyncClient, staff_jwt: str, counter_id: str, claimed: list, max_calls: int) -> None:
    """Races until the queue is genuinely empty, not just once per desk --
    `tokens_one_per_desk` blocks a SECOND call_next on the same counter
    while its current token is still 'called'/'serving' (409
    counter_busy), so without completing each claimed token, a desk can
    only ever claim exactly one, no matter how many times this loops
    (found live: 60 waiting, only 2 total claimed). complete_token moves
    'serving' -> 'done', freeing the desk for the next call_next -- the
    same real staff action a real desk performs, just done immediately
    rather than after a real consultation, since this loop's job is
    draining the queue, not timing a real service duration."""
    headers = {"apikey": ANON_KEY, "Authorization": f"Bearer {staff_jwt}"}
    for _ in range(max_calls):
        resp = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/call_next", headers=headers, json={"p_counter": counter_id})
        if resp.status_code != 200:
            break  # counter_closed / forbidden -- stop this loop
        body = resp.json()
        rows = body if isinstance(body, list) else [body]
        if not rows:
            break  # 200 with an empty set IS "queue empty" (call_next returns
            # `setof tokens`) -- the real stop condition for "race until empty".
        for row in rows:
            if not row or "id" not in row:
                continue
            claimed.append(row["id"])
            start_resp = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/start_serving", headers=headers, json={"p_token": row["id"]})
            if start_resp.status_code != 200:
                print(f"WARNING: start_serving({row['id']}) got {start_resp.status_code}: {start_resp.text[:200]}")
                continue
            done_resp = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/complete_token", headers=headers, json={"p_token": row["id"]})
            if done_resp.status_code != 200:
                print(f"WARNING: complete_token({row['id']}) got {done_resp.status_code}: {done_resp.text[:200]}")


async def count_waiting_tokens(client: httpx.AsyncClient, service_id: str) -> int:
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/tokens", headers={**SERVICE_HEADERS, "Prefer": "count=exact"},
        params={"select": "id", "service_id": f"eq.{service_id}", "status": "eq.waiting", "limit": "1"},
    )
    resp.raise_for_status()
    content_range = resp.headers.get("content-range", "*/0")
    return int(content_range.split("/")[-1])


async def run_call_next_race(
    client: httpx.AsyncClient, staff_jwt: str, counter_ids: list[str], service_id: str, max_calls_per_loop: int
) -> dict:
    """2 parallel loops against the loadtest org's own 2 desks, run until
    each desk's own queue view is empty (see call_next_loop) -- the real
    concurrency risk: two desks racing the same waiting queue must never
    both claim the same token, enforced by tokens_one_per_desk's unique
    index on counter_id. Reports how many tokens were actually waiting
    before the race started, not just assumed -- a meaningful race needs
    a real queue to contend over, not an empty one two loops trivially
    agree on."""
    waiting_before = await count_waiting_tokens(client, service_id)
    print(f"{waiting_before} tokens waiting before the call_next race")

    counter_a, counter_b = counter_ids[0], counter_ids[1]
    claimed_a: list = []
    claimed_b: list = []

    race_client = httpx.AsyncClient(timeout=30.0)
    try:
        await asyncio.gather(
            call_next_loop(race_client, staff_jwt, counter_a, claimed_a, max_calls_per_loop),
            call_next_loop(race_client, staff_jwt, counter_b, claimed_b, max_calls_per_loop),
        )
    finally:
        await race_client.aclose()

    all_claimed = claimed_a + claimed_b
    dupes = find_duplicates(all_claimed)
    return {
        "waiting_before_race": waiting_before,
        "counter_a": counter_a,
        "counter_b": counter_b,
        "claimed_by_a": len(claimed_a),
        "claimed_by_b": len(claimed_b),
        "total_claimed": len(all_claimed),
        "double_calls": dupes,
    }


async def issue_token_via_db(pool: asyncpg.Pool, patient_id: str, service_id: str) -> tuple[bool, float, dict | None]:
    """Calls issue_token() the same way PostgREST would internally --
    auth.uid() is `select coalesce(current_setting('request.jwt.claim.sub',
    true), ...)::uuid` (confirmed live against the real function
    definition), so set_config'ing that GUC per-transaction is what makes
    the SECURITY DEFINER RPC see this specific patient's identity, with no
    Kong/PostgREST/GoTrue anywhere in the path -- a real proof that DB-
    level concurrency (the advisory lock + unique constraints, not HTTP
    connection handling) is what actually gates this correctly."""
    started = time.monotonic()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT set_config('request.jwt.claim.sub', $1, true)", patient_id)
                row = await conn.fetchrow("SELECT * FROM issue_token($1)", uuid.UUID(service_id))
        latency_ms = (time.monotonic() - started) * 1000
        return True, latency_ms, dict(row) if row else None
    except Exception as exc:  # noqa: BLE001 - a real DB error (lock timeout, constraint) is a normal outcome here
        latency_ms = (time.monotonic() - started) * 1000
        return False, latency_ms, {"error": str(exc)}


async def run_db_level_burst(patient_ids: list[str], service_id: str) -> dict:
    """1000 concurrent logical issue_token calls, but the DB connection
    POOL (not HTTP) is the real limiting resource -- DB_BURST_POOL_SIZE
    real connections serve DB_BURST_SIZE concurrent asyncio tasks, each
    awaiting pool.acquire() until one frees up. Keeps pool usage sane on a
    shared prod Postgres while still proving 1000-wide logical concurrency
    at the database layer."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=DB_BURST_POOL_SIZE)
    try:
        started = time.monotonic()
        results = await asyncio.gather(*(issue_token_via_db(pool, pid, service_id) for pid in patient_ids))
        wall_seconds = time.monotonic() - started
    finally:
        await pool.close()

    successes = [r for r in results if r[0]]
    failures = [r for r in results if not r[0]]
    numbers = [r[2]["number"] for r in successes if r[2] and "number" in r[2]]
    dupes = find_duplicates(numbers)

    summary = summarize_latencies([r[1] for r in results])
    summary.update(
        {
            "wave": "db_level_burst",
            "pool_size": DB_BURST_POOL_SIZE,
            "requested": len(patient_ids),
            "succeeded": len(successes),
            "failed": len(failures),
            "error_rate": round(len(failures) / len(patient_ids), 4) if patient_ids else 0.0,
            "duplicate_numbers": dupes,
            "tokens_per_sec": round(len(successes) / wall_seconds, 2) if wall_seconds > 0 else 0.0,
            "sample_errors": _first_distinct_errors([r[2].get("error", "") for r in failures if r[2]]),
        }
    )
    return summary


async def cleanup(client: httpx.AsyncClient, org_id: str | None, user_ids: list[str]) -> None:
    """Order matters -- found live: profiles -> tokens has no cascade
    either (no cascade on tokens_patient_id_fkey), so deleting a patient's
    auth.users row while their token still exists 409s too. Org (and its
    notifications) must go first.

    Sweeps by email pattern too, not just `user_ids` -- found live: a
    partial-setup failure (GoTrue 500s under concurrent load) can leave
    accounts this run created but never got to track (a task that raised
    before appending to `created_ids`, or a run that crashed before
    reaching here at all from an earlier version of this script)."""
    if org_id:
        await delete_org_and_dependents(client, org_id)

    known_ids = set(user_ids)
    resp = await client.get(f"{SUPABASE_URL}/auth/v1/admin/users", headers=SERVICE_HEADERS)
    if resp.status_code < 400:
        for u in resp.json().get("users", []):
            if u.get("email", "").endswith("@loadtest.invalid"):
                known_ids.add(u["id"])
    else:
        print(f"WARNING: could not list users for cleanup sweep, got {resp.status_code}: {resp.text[:200]}")

    for user_id in known_ids:
        resp = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=SERVICE_HEADERS,
        )
        if resp.status_code >= 400:
            print(f"WARNING: user cleanup for {user_id} got {resp.status_code}: {resp.text[:200]}")


async def main() -> int:
    db_burst_enabled = bool(DATABASE_URL)
    total_patients = sum(WAVES) + (DB_BURST_SIZE if db_burst_enabled else 0) + RACE_TOP_UP_RESERVE
    org_id = None
    all_user_ids: list[str] = []

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            print(f"Creating {ORG_SLUG} + service + 2 counters (isolated from the demo org)...")
            org_id = await create_org(client)
            service_id = await create_service(client, org_id)
            counter_ids = await create_counters(client, org_id, service_id)
            staff_id, staff_jwt = await create_staff(client, org_id, all_user_ids)

            print(f"Creating {total_patients} test patients via GoTrue admin API (bounded to {SETUP_CONCURRENCY} at once)...")
            setup_semaphore = asyncio.Semaphore(SETUP_CONCURRENCY)
            patient_results = await asyncio.gather(
                *(create_test_user(client, "patient", i, setup_semaphore, all_user_ids) for i in range(total_patients)),
                return_exceptions=True,
            )
            patient_ids = [r for r in patient_results if isinstance(r, str)]
            failed_creates = len(patient_results) - len(patient_ids)
            if failed_creates:
                print(f"WARNING: {failed_creates} patient creations failed even after retries -- caught by cleanup's email sweep")
            jwts_by_id = {uid: mint_jwt(uid) for uid in patient_ids}

            print(f"Completing {len(patient_ids)} patient profiles (real complete_my_profile RPC, bounded to {SETUP_CONCURRENCY} at once)...")
            profile_semaphore = asyncio.Semaphore(SETUP_CONCURRENCY)
            profile_results = await asyncio.gather(
                *(complete_profile(client, jwts_by_id[uid], i, profile_semaphore) for i, uid in enumerate(patient_ids)),
                return_exceptions=True,
            )
            ready_ids = [uid for uid, r in zip(patient_ids, profile_results) if not isinstance(r, Exception)]
            failed_profiles = len(patient_ids) - len(ready_ids)
            if failed_profiles:
                print(f"WARNING: {failed_profiles} profile completions failed even after retries -- those patients are excluded from the waves below")
            jwts = [jwts_by_id[uid] for uid in ready_ids]

        report: dict = {"waves": []}
        # Disjoint slices -- reusing a patient across waves hits issue_token's
        # real already_active 409 (one active ticket per service), which is
        # correct RPC behavior, not something a load test should trip over.
        # Sliced off however many patients actually made it through setup,
        # not blindly assumed every wave got its full requested size.
        offset = 0
        for wave_size in WAVES:
            wave_jwts = jwts[offset:offset + wave_size]
            offset += wave_size
            if not wave_jwts:
                print(f"WARNING: skipping {wave_size}_concurrent -- no patients left after earlier failures")
                continue
            label = f"{wave_size}_concurrent"
            print(f"Firing {len(wave_jwts)} concurrent issue_token calls ({label})...")
            wave = await run_issue_token_wave(wave_jwts, service_id, label)
            report["waves"].append(wave)
            print(json.dumps(wave, indent=2))
            if wave["error_rate"] > MAX_ERROR_RATE or wave["p95_ms"] > MAX_P95_MS:
                print(
                    f"STOPPING further waves: {label} error_rate={wave['error_rate']} "
                    f"(max {MAX_ERROR_RATE}) p95_ms={wave['p95_ms']} (max {MAX_P95_MS})"
                )
                break

        if db_burst_enabled:
            db_burst_ids = ready_ids[offset:offset + DB_BURST_SIZE]
            offset += len(db_burst_ids)  # so the top-up step below never reuses these patients
            if db_burst_ids:
                print(
                    f"Firing {len(db_burst_ids)} concurrent issue_token calls straight against "
                    f"Postgres (pool size {DB_BURST_POOL_SIZE}, no Kong/PostgREST/GoTrue)..."
                )
                db_burst = await run_db_level_burst(db_burst_ids, service_id)
                report["db_level_burst"] = db_burst
                print(json.dumps(db_burst, indent=2))
            else:
                print("WARNING: skipping db_level_burst -- no patients left after earlier failures")
        else:
            print("DATABASE_URL not set -- skipping the DB-level burst (HTTP waves above still ran)")

        # Top up the queue before racing, using patients earlier waves/burst
        # never got to (an early stop or a failed wave can leave the queue
        # thin) -- a race against <50 waiting tokens doesn't prove much.
        async with httpx.AsyncClient(timeout=30.0) as top_up_client:
            waiting_now = await count_waiting_tokens(top_up_client, service_id)
        if waiting_now < MIN_RACE_WAITING:
            spare_jwts = jwts[offset:offset + (MIN_RACE_WAITING - waiting_now)]
            if spare_jwts:
                print(f"Only {waiting_now} waiting -- topping up with {len(spare_jwts)} more issue_token calls before the race...")
                top_up = await run_issue_token_wave(spare_jwts, service_id, "race_top_up")
                report["race_top_up"] = top_up
                offset += len(spare_jwts)
            else:
                print(f"WARNING: only {waiting_now} waiting and no spare patients left to top up with")

        print("Racing 2 parallel call_next loops until the queue is empty...")
        async with httpx.AsyncClient(timeout=30.0) as client:
            race = await run_call_next_race(client, staff_jwt, counter_ids, service_id, max_calls_per_loop=total_patients)
        if race["waiting_before_race"] < MIN_RACE_WAITING:
            print(
                f"WARNING: only {race['waiting_before_race']} tokens were waiting before the race -- "
                "not a very meaningful concurrency proof at this scale"
            )
        report["call_next_race"] = race
        print(json.dumps(race, indent=2))

        print("\n=== FINAL REPORT ===")
        print(json.dumps(report, indent=2))

        ok = True
        for wave in report["waves"]:
            if wave["duplicate_numbers"]:
                print(f"FAIL: duplicate token numbers in {wave['wave']}: {wave['duplicate_numbers']}")
                ok = False
        if report.get("db_level_burst", {}).get("duplicate_numbers"):
            print(f"FAIL: duplicate token numbers in db_level_burst: {report['db_level_burst']['duplicate_numbers']}")
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
