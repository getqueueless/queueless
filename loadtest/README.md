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

## Run on prod (the deploy session's job, not built here)

Same script, pointed at `https://api.lpu.lol`'s underlying Supabase URL with real prod
keys pulled from the VPS's own `supabase/.env` (never copied elsewhere). **This creates
real rows** (test patients, tokens) against prod — after the run, reset demo data the
same way any other demo-reset already happens for this project (delete the
`loadtest-patient-*@loadtest.invalid` `auth.users` rows and their cascaded `tokens`
rows; a service-role `DELETE /auth/v1/admin/users/{id}` per created id, or a single
`delete from auth.users where email like 'loadtest-patient-%@loadtest.invalid'` run
directly against prod Postgres by whoever holds that access — not from apps/api, which
has no grant on `auth.users` or `profiles` writes).

## Slow queries / indexes found

None measured yet — this section fills in from a real run's `EXPLAIN ANALYZE` output
(run manually against the RPCs' actual query plans once a live run happens; any finding
goes into `docs/DECISIONS.md` for the DB agent, since `supabase/migrations` isn't this
session's to edit).
