# Load test — issue_token / call_next concurrency + latency

Fires 200, then 1000, concurrent `issue_token` calls at one real service, then races
two parallel `call_next` loops against real counters. Asserts zero duplicate ticket
numbers and zero double-called tokens; reports p50/p95/p99 latency and error rate.

## Status: built and correct, not yet run against a live full stack

This tool is complete and its pure logic (percentile math, duplicate detection —
`stats.py`) is self-checked (`python3 stats.py`, no dependencies). It has **not** been
run end-to-end against a live Kong+GoTrue+PostgREST+Postgres stack from this session:
this worktree has no safe local credentials for one — a full local stack is already
running on this shared machine under another session's own `generate-keys.sh` output,
which isn't this session's to read. Bringing up a fresh instance from this worktree
(`cd supabase && sh generate-keys.sh --update-env && docker compose up -d`) is the
real next step for whoever runs this for real; it takes a few minutes and produces a
fresh, safe-to-use local `.env`. Said plainly rather than presented as already proven.

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
| `SUPABASE_SERVICE_ROLE_KEY` | admin key, used ONLY to create test patient users | `supabase/.env`'s `SERVICE_ROLE_KEY` — real spend/access risk if leaked, hold in env only, never log it |
| `SUPABASE_JWT_SECRET` | same secret PostgREST verifies bearer tokens against | `supabase/.env`'s `JWT_SECRET` |
| `LOADTEST_SERVICE_ID` | a real `services.id` to hammer with `issue_token` | pick a demo org's service |
| `LOADTEST_COUNTER_IDS` | comma-separated `counters.id`s (2 recommended) | pick 2 counters serving that service |
| `LOADTEST_STAFF_JWT` | a real staff/admin session JWT, for `call_next` | optional — race is skipped without it, with a printed note, not silently |
| `LOADTEST_N_LOW` / `LOADTEST_N_HIGH` | wave sizes | default 200 / 1000 |

## Run locally

```bash
cd loadtest
uv run --with httpx --with pyjwt python load_test.py
```

Exit code is non-zero if any duplicate numbers or double-calls were found — wire this
into CI or a pre-demo check the same way.

## Run on prod (the deploy session's job — not run from here)

**Not run this session.** Capped at 200 concurrent users total (not the 200-then-1000
local default) — a shared 7.6 GB VPS running other production apps doesn't get a 1000-
wide burst. Run from the VPS, against prod's own Supabase, with prod's own keys (never
copied off it):

```bash
# On the VPS, from /opt/queueless:
set -a; . supabase/.env; set +a          # SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/JWT_SECRET

# Real service_id + 2 counter_ids for the city-hospital demo org, looked up live
# (board_services/counters are anon-readable -- supabase/migrations/0030) rather
# than hardcoded, since seed.sh generates fresh UUIDs per environment:
export LOADTEST_SERVICE_ID=$(curl -s "$SUPABASE_URL/rest/v1/services?select=id&org_id=$(curl -s "$SUPABASE_URL/rest/v1/organizations?select=id&slug=eq.city-hospital" -H "apikey: $ANON_KEY" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')&code=eq.OPD" -H "apikey: $ANON_KEY" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
export LOADTEST_COUNTER_IDS=$(curl -s "$SUPABASE_URL/rest/v1/counters?select=id&org_id=eq.$(curl -s "$SUPABASE_URL/rest/v1/organizations?select=id&slug=eq.city-hospital" -H "apikey: $ANON_KEY" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')&limit=2" -H "apikey: $ANON_KEY" | python3 -c 'import json,sys;print(",".join(r["id"] for r in json.load(sys.stdin)))')

# One real counter1@lpu.lol session JWT (from queueless-qa/.env.qa's COUNTER1_EMAIL/
# PASSWORD via POST $SUPABASE_URL/auth/v1/token?grant_type=password) for the
# call_next race -- optional, race is skipped without it.
export LOADTEST_STAFF_JWT=<real staff session JWT>

export SUPABASE_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_JWT_SECRET=$JWT_SECRET
export LOADTEST_N_LOW=100 LOADTEST_N_HIGH=200          # cap: 200 concurrent, never 1000

cd /opt/queueless/loadtest
uv run --with httpx --with pyjwt python load_test.py | tee /tmp/loadtest-prod-$(date +%F).json
```

**Duration.** Both waves fire via `asyncio.gather` (true burst, not sustained
throughput) — the 100- and 200-wide `issue_token` waves each complete in roughly one
request's own latency, not `N × latency`. `create_test_patient` (200 sequential-ish
GoTrue admin calls) is the slow part, ~1-3 minutes. `call_next_loop` is NOT gathered
internally (each loop awaits its calls one at a time), so the race with
`max_calls_per_loop=200` can run up to ~200 sequential round trips per loop (two loops
in parallel) — budget another 1-2 minutes. **Total: expect 3-6 minutes end to end**,
almost all of it patient creation and the call_next race, not the issue_token bursts
themselves.

**Expected p95 and error rate.** No prod baseline exists yet (this has only run against
a local dev stack, not prod — see Status above). Targets, not measurements:
- **Error rate: 0%.** `tokens_service_day_number_unique` and `tokens_one_per_desk`
  (both real DB constraints, see above) make a duplicate/double-call a hard DB error,
  not a race outcome — the only errors expected under normal load are `429`s if 200
  concurrent requests exceed `/predict`-style per-route limits, and `issue_token`/
  `call_next` are called directly against PostgREST, which slowapi doesn't rate-limit.
- **p95 target: well under 1s per `issue_token` call.** The one real, measured finding
  this session (`docs/DECISIONS.md`, 2026-09-26 EXPLAIN ANALYZE) is `call_next`'s
  queue-pop query going from a 827-cost/1.79ms full seq scan to a 17-cost/0.04ms index
  scan with a new partial index — not yet applied to prod (that index is a request to
  the DB agent, still pending in DECISIONS.md as of this write-up). If it lands before
  this runs, `call_next` p95 should track close to that number; if not, expect the
  slower pre-index shape instead. `issue_token`'s own hot path wasn't benchmarked with
  real EXPLAIN ANALYZE (see DECISIONS.md's note on why) — no target claimed for it
  beyond "under a second," which is the demo's actual UX bar, not a measured number.
- **If either number comes back materially worse**, the DB agent's index (above) is the
  first thing to check landed, then `docker stats` on the VPS to rule out CPU/memory
  contention from the other apps sharing it.

## Cleanup (demo-reset) — run immediately after, same session

Two different things need resetting, since the load test creates two different kinds of
row that neither script alone clears:

```bash
# 1. supabase/scripts/demo-reset.sh already exists (DB team's own tool) and clears
#    exactly what a load test dirties: today's live queue (tokens whose service_day is
#    today) and the per-service numbering counter. It does NOT touch accounts, so it
#    alone is not enough -- see step 2. Run from /opt/queueless/supabase:
sh scripts/demo-reset.sh

# 2. The loadtest-created GoTrue patient accounts (loadtest-patient-*@loadtest.invalid)
#    are NOT touched by demo-reset.sh -- delete them directly (apps/api's own DB role has
#    no grant on auth.users, so this has to run as postgres, same access level
#    demo-reset.sh itself already uses):
docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres \
    -c "delete from auth.users where email like 'loadtest-patient-%@loadtest.invalid'"
```

Run both every time, in that order — demo-reset.sh first (fast, idempotent, safe to run
even if step 2 is skipped once), then the patient cleanup.

## Slow queries / indexes found

One real finding so far, from `EXPLAIN (ANALYZE, BUFFERS)` against a local 30k-row
seeded fixture (not yet run against prod — see above): `call_next`'s queue-pop
subquery was a full seq scan (cost 827, 1.79ms, 470 buffers); a new partial index
(`tokens_waiting_queue_idx` on `(org_id, service_id, service_day, lane_rank,
priority_at, number) where status = 'waiting'`) brought it to an index scan (cost 17,
0.04ms, 11 buffers). Full writeup and the exact index SQL: `docs/DECISIONS.md`,
2026-09-26 entry — that's the DB agent's file to apply it from, not this one.
`issue_token`'s own rate-check index is recommended by shape only in the same entry,
explicitly flagged as not benchmarked (synthetic timestamps let Postgres constant-fold
the query locally). Any further finding from a real prod run goes in the same place.
