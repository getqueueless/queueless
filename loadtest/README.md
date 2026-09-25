# Load test — issue_token / call_next concurrency + latency

Fires 200, then 1000, concurrent `issue_token` calls at a service, then races
two parallel `call_next` loops against real counters. Asserts zero duplicate ticket
numbers and zero double-called tokens; reports p50/p95/p99 latency and error rate.

## Status: verified correct, small scale, live against prod

The script creates its own throwaway org (`loadtest-org-<random>`, own service, own 2 counters,
own staff account) and tears it down in a `finally` block — it never targets the demo
org, never touches a real patient's data, and is safe to run at any time without a
demo-reset. Verified live against prod this session at small scale (`LOADTEST_WAVES=3,4`,
`LOADTEST_DB_BURST_SIZE=3`) — not a load test, a correctness check: org/service/counters/
staff created, patients created and had their profiles completed via the real
`complete_my_profile` RPC (confirmed `issue_token` sends no SMS or other real-world side
effect first — this repo has no SMS integration at all, only Expo push), `issue_token`
succeeded for every patient over both the HTTP waves and the DB-level burst (via an SSH
tunnel to the VPS's `POSTGRES_HOST_PORT` for this session's own verification — real
latency there was 3.6-5.3s, an artifact of the tunnel, not the DB itself; on the VPS this
runs at native localhost speed), `call_next` raced cleanly with zero double-calls, and
cleanup left nothing behind (`organizations` row gone, all `@loadtest.invalid`
`auth.users` rows gone — checked directly against prod after the run). The full
100/200/500/1000-wide escalation is in progress against prod (infra runs it, see "Run on
prod" below for the exact command) — real results so far:

| Wave | p95 | Error rate | Duplicate numbers | Throughput |
|---|---|---|---|---|
| 100 | 500 ms | 0% | 0 | 183 tok/s |
| 200 | 1.33 s | 0% | 0 | *(not recorded)* |
| 500 | *(pending)* | | | |
| 1000 | *(pending)* | | | |

(500 and 1000 hit a real, since-fixed bug on the first attempt — `services.
max_tokens_per_day` defaults to 500/day and every wave targets the same service with
numbering that climbs across waves, so `issue_token` 409'd `queue_full` past a
cumulative 500 tokens. Fixed: the loadtest service is now created with
`max_tokens_per_day=100000`. Rerunning 500/1000 with the fix.)

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
| `LOADTEST_WAVES` | comma-separated fresh-user wave sizes, run in order, each getting its own disjoint slice of patients | default `100,200,500,1000` |
| `LOADTEST_SETUP_CONCURRENCY` | how many GoTrue admin/users + complete_my_profile calls run at once during setup (not the measured phase) | default 8 -- GoTrue's own DB pool exhausts well before this |
| `DATABASE_URL` | optional -- a direct Postgres connection (e.g. `postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:54322/postgres` on the VPS, not the `supabase-db:5432` internal hostname unless the container is on `queueless_default`) enables a DB-level burst that calls `issue_token` straight against Postgres, no Kong/PostgREST/GoTrue in the path. Skipped with a clear note if unset. | `supabase/.env`'s `POSTGRES_PASSWORD` + `POSTGRES_HOST_PORT` |
| `LOADTEST_DB_BURST_SIZE` / `LOADTEST_DB_BURST_POOL_SIZE` | how many concurrent logical calls / how many real Postgres connections serve them | default 1000 / 20 |

Nothing else — the script creates its own org/service/counters/staff account, so there
is no `LOADTEST_SERVICE_ID`/`LOADTEST_COUNTER_IDS`/`LOADTEST_STAFF_JWT` to look up or
supply anymore.

Each wave stops the whole run early (prints why, keeps every result gathered so far) if
its error rate exceeds 5% or its p95 exceeds 10s -- no point burning through a 1000-wide
wave once a 500-wide one already showed real trouble.

## Run locally

```bash
cd loadtest
uv run --with httpx --with pyjwt --with asyncpg python load_test.py
```

Exit code is non-zero if any duplicate numbers or double-calls were found — wire this
into CI or a pre-demo check the same way.

## Run on prod

Escalating waves, each on its own fresh patients, with an automatic early stop (see
above) if one shows real trouble — no need to hand-pick a single safe concurrency
number. Run from the VPS, against prod's own Supabase, with prod's own keys (never
copied off it). `DATABASE_URL` uses `POSTGRES_HOST_PORT` (the port Postgres publishes on
the VPS's own loopback, e.g. `127.0.0.1:54322`), not the internal `supabase-db:5432`
hostname — only reachable from that hostname inside `queueless_default`, not from a
`--network host` container:

```bash
# On the VPS, from /opt/queueless:
set -a; . supabase/.env; set +a          # SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/JWT_SECRET/POSTGRES_PASSWORD/POSTGRES_HOST_PORT
export SUPABASE_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_JWT_SECRET=$JWT_SECRET
export DATABASE_URL="postgresql://postgres:$(python3 -c 'import urllib.parse,os;print(urllib.parse.quote(os.environ["POSTGRES_PASSWORD"],safe=""))')@127.0.0.1:${POSTGRES_HOST_PORT}/postgres"
export LOADTEST_WAVES=100,200,500,1000

cd /opt/queueless/loadtest
uv run --with httpx --with pyjwt --with asyncpg python load_test.py | tee /tmp/loadtest-prod-$(date +%F).json
```

No separate cleanup step needed — the script's own `finally` block deletes its org (and
everything under it) and every `@loadtest.invalid` test account it created, verified
live (see Status above). The org's slug is `loadtest-org-<8 random hex chars>`, unique
per run, not a fixed `loadtest-org` — found live: two runs against the same prod at once
raced on delete-then-create under a shared fixed slug, and one run's cleanup deleted the
other's still-in-progress org. Never run two instances of this script against the same
prod at the same time even so — they'd still both hammer `services.max_tokens_per_day`
and the same counters/staff-role checks aren't scoped per-run. If a run is killed hard
enough to skip even the `finally` block, its uniquely-slugged org is simply left behind
(harmless — a later run's own fresh unique slug can never collide with it); only orphaned
`@loadtest.invalid` `auth.users` rows from that scenario would need a manual sweep:
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
