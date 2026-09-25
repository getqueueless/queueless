# Load test — issue_token / call_next concurrency + latency

Fires 200, then 1000, concurrent `issue_token` calls at a service, then races
two parallel `call_next` loops against real counters. Asserts zero duplicate ticket
numbers and zero double-called tokens; reports p50/p95/p99 latency and error rate.

## Status: verified correct, small scale, live against prod

The script creates its own throwaway org (`loadtest-org`, own service, own 2 counters,
own staff account) and tears it down in a `finally` block — it never targets the demo
org, never touches a real patient's data, and is safe to run at any time without a
demo-reset. Verified live against prod this session at `LOADTEST_N_LOW=LOADTEST_N_HIGH=3`
(small, not a load test, a correctness check): org/service/counters/staff created,
patients created and had their profiles completed via the real `complete_my_profile` RPC
(confirmed `issue_token` sends no SMS or other real-world side effect first — this repo
has no SMS integration at all, only Expo push), `issue_token` succeeded for every
patient, `call_next` raced cleanly with zero double-calls, and cleanup left nothing
behind (`organizations` row gone, all `@loadtest.invalid` `auth.users` rows gone —
checked directly against prod after the run). The 200/1000-wide run itself has **not**
been run — see "Run on prod" below for the exact command; infra runs that one.

**Found and fixed while verifying:** `issue_token` 403s with `profile_incomplete` since
migration 0037 — a probe using un-completed test patients never got past that. Also,
`organizations` → `tokens` cascades on delete, but `tokens` → `notifications` does
**not** (no cascade on `notifications_token_id_fkey`), so deleting a loadtest org
directly 409s once any of its tokens has a notification; `cleanup()` now clears
`notifications` for the org's tokens first.

## What the real DB already guarantees (this tool proves it holds under load, not that it exists)

- `tokens_service_day_number_unique unique (service_id, service_day, number)` — the
  database itself refuses a duplicate ticket number; a race would surface as an error
  on one of the concurrent calls, not a silent duplicate.
- `tokens_one_per_desk unique index (counter_id)` — a counter can hold at most one
  active token at a time, which is what actually prevents two `call_next` loops on
  different desks from both claiming the same waiting ticket.

## Credentials (environment only — never commit any of these)

| Variable | What it is | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | Kong gateway URL, e.g. `http://localhost:8000` | `supabase/.env`'s `SUPABASE_PUBLIC_URL` |
| `SUPABASE_ANON_KEY` | anon API key | `supabase/.env`'s `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | admin key — creates/deletes the loadtest org, service, counters, staff and patient users | `supabase/.env`'s `SERVICE_ROLE_KEY` — real spend/access risk if leaked, hold in env only, never log it |
| `SUPABASE_JWT_SECRET` | same secret PostgREST verifies bearer tokens against | `supabase/.env`'s `JWT_SECRET` |
| `LOADTEST_N_LOW` / `LOADTEST_N_HIGH` | wave sizes | default 200 / 1000 |

Nothing else — the script creates its own org/service/counters/staff account, so there
is no `LOADTEST_SERVICE_ID`/`LOADTEST_COUNTER_IDS`/`LOADTEST_STAFF_JWT` to look up or
supply anymore.

## Run locally

```bash
cd loadtest
uv run --with httpx --with pyjwt python load_test.py
```

Exit code is non-zero if any duplicate numbers or double-calls were found — wire this
into CI or a pre-demo check the same way.

## Run on prod

Capped at 200 concurrent users total (not the 200-then-1000 local default) — a shared
7.6 GB VPS running other production apps doesn't get a 1000-wide burst. Run from the
VPS, against prod's own Supabase, with prod's own keys (never copied off it):

```bash
# On the VPS, from /opt/queueless:
set -a; . supabase/.env; set +a          # SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/JWT_SECRET
export SUPABASE_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_JWT_SECRET=$JWT_SECRET
export LOADTEST_N_LOW=100 LOADTEST_N_HIGH=200          # cap: 200 concurrent, never 1000

cd /opt/queueless/loadtest
uv run --with httpx --with pyjwt python load_test.py | tee /tmp/loadtest-prod-$(date +%F).json
```

No separate cleanup step needed — the script's own `finally` block deletes
`loadtest-org` (and everything under it) and every `@loadtest.invalid` test account it
created, verified live (see Status above). If a run is killed hard enough to skip even
the `finally` block, the next run's own startup step (`delete_org_if_exists`) clears any
leftover `loadtest-org` before creating a fresh one; only orphaned `@loadtest.invalid`
`auth.users` rows from that scenario would need a manual sweep:
`delete from auth.users where email like '%@loadtest.invalid'` (via
`docker exec -i supabase-db psql ...`, same access level `demo-reset.sh` uses).

**Duration.** Both `issue_token` waves fire via `asyncio.gather` (true burst, not
sustained throughput) — each completes in roughly one request's own latency, not
`N × latency`. Creating + completing the profiles of 100+200=300 patients (sequential-
ish GoTrue admin + RPC calls) is the slow part, ~2-4 minutes. `call_next_loop` is NOT
gathered internally (each loop awaits its calls one at a time), so the race can run up
to 300 sequential round trips per loop (two loops in parallel) — budget another
1-2 minutes. **Total: expect 4-7 minutes end to end**, almost all of it patient
creation/profile completion and the call_next race, not the issue_token bursts
themselves.

**Expected p95 and error rate.** No prod baseline exists yet at the 200-wide scale
(only the 3-wide correctness check above has run against prod). Targets, not
measurements:
- **Error rate: 0%.** `tokens_service_day_number_unique` and `tokens_one_per_desk`
  (both real DB constraints, see above) make a duplicate/double-call a hard DB error,
  not a race outcome — `issue_token`/`call_next` are called directly against
  PostgREST, which slowapi doesn't rate-limit, so no `429`s are expected either.
- **p95 target: well under 1s per `issue_token` call.** The one real, measured finding
  this session (`docs/DECISIONS.md`, 2026-09-26 EXPLAIN ANALYZE) is `call_next`'s
  queue-pop query going from a 827-cost/1.79ms full seq scan to a 17-cost/0.04ms index
  scan with a new partial index — check `docs/DECISIONS.md` for whether the DB agent
  has applied it to prod yet; if so, `call_next` p95 should track close to that number.
  `issue_token`'s own hot path wasn't benchmarked with real EXPLAIN ANALYZE (see
  DECISIONS.md's note on why) — no target claimed for it beyond "under a second,"
  which is the demo's actual UX bar, not a measured number.
- **If either number comes back materially worse**, the DB agent's index (above) is the
  first thing to check landed, then `docker stats` on the VPS to rule out CPU/memory
  contention from the other apps sharing it.

## Slow queries / indexes found

One real finding so far, from `EXPLAIN (ANALYZE, BUFFERS)` against a local 30k-row
seeded fixture (not yet run against prod at load — see above): `call_next`'s queue-pop
subquery was a full seq scan (cost 827, 1.79ms, 470 buffers); a new partial index
(`tokens_waiting_queue_idx` on `(org_id, service_id, service_day, lane_rank,
priority_at, number) where status = 'waiting'`) brought it to an index scan (cost 17,
0.04ms, 11 buffers). Full writeup and the exact index SQL: `docs/DECISIONS.md`,
2026-09-26 entry — that's the DB agent's file to apply it from, not this one.
`issue_token`'s own rate-check index is recommended by shape only in the same entry,
explicitly flagged as not benchmarked (synthetic timestamps let Postgres constant-fold
the query locally). Any further finding from a real prod run goes in the same place.
