# Threat model — apps/api

STRIDE-lite, one page. Scope: the Python FastAPI service in `apps/api` only.

## 1. Assets

- `SUPABASE_JWT_SECRET` — the shared HS256 signing key. Anyone with it can forge any user's identity.
- Patient PII in `tokens` / `profiles` rows (name-adjacent queue state, service visited, role).
- Expo push tokens in `push_tokens` — device-addressable, spammable if leaked.
- The Postgres connection string (`DATABASE_URL` / `DATABASE_URL_DIRECT`) — full read/write to the DB.
- Admin/staff capability — the ability to act as `require_role("staff", "admin")`.
- `DEEPSEEK_API_KEY` — real, metered spend behind it. Anyone who can reach an AI-backed route can
  cause real API calls against this key.

## 2. Actors / trust boundaries

- Anonymous client (no JWT) — e.g. `POST /predict`, `GET /health`, `GET /ready`.
- Patient-role JWT holder — a real Supabase-issued token, `profiles.role = 'patient'`.
- Staff/admin-role JWT holder — `profiles.role` in `('staff', 'admin')`.
- API → Postgres (asyncpg pool + a dedicated LISTEN connection).
- API → Expo push service (outbound HTTPS via `exponent-server-sdk`).

## 3. Top threats (STRIDE)

| # | Threat | STRIDE |
|---|---|---|
| T1 | Forged, expired, or `alg:none` JWT accepted | Spoofing / Tampering |
| T2 | Role or claim tampering via request body, query param, or custom header (e.g. `X-User-Role`) | Elevation of Privilege |
| T3 | apps/api's own writes (marking a notification delivered) leave no audit trail | Repudiation |
| T4 | Verbose error responses leak stack traces or internal field paths | Information Disclosure |
| T5 | CORS wildcard (or a reflected `Origin`) lets any site read authenticated responses | Information Disclosure |
| T6 | Unthrottled endpoints let one client exhaust the process | Denial of Service |
| T7 | Mass-assignment via extra JSON fields (e.g. a `role` field client didn't need) | Elevation of Privilege |
| T8 | An authenticated staff/admin loops an AI-backed route, running up real DeepSeek spend | Denial of Service (financial) |
| T9 | `/admin/ask`'s question smuggles instructions to DeepSeek to call an arbitrary/non-whitelisted DB function | Elevation of Privilege / Tampering |

## 4. Mitigations (1:1 with the threats above)

- **T1** — `decode_token` (`app/auth.py`) hard-codes `algorithms=["HS256"]` and `audience="authenticated"`; it never reads the token's own `alg` header, so an `alg:none` token or one signed with any other algorithm/secret fails signature verification and is rejected with 401. `options={"require": ["exp", "sub", "aud"]}` rejects tokens missing any of those claims.
- **T2 / T7** — Every request model uses `ConfigDict(strict=True, extra="forbid")` (see `PushTokenIn` in `app/notifications.py`, `PredictIn` in `app/routes/predict.py`), so an extra `role` field is a 422, not silently ignored data. Authorization never reads the JWT's own `role`/`user_metadata`/`app_metadata` or any client-supplied header/body field — `require_role` (`app/auth.py`) derives the role solely from `get_role`, a server-side `SELECT role FROM profiles WHERE user_id = $1` keyed off the verified JWT `sub`, cached in-process for `role_cache_ttl_seconds` (default 5s — the ceiling on how fast a revoked staff member is actually locked out, not instant).
- **T3** — `POST /admin/retrain` (`app/routes/admin.py`) writes one `audit_log` row per successful retrain via `private.write_audit()` (`supabase/migrations/0036`) — a narrow RPC, since `queueless_api` still has no direct `INSERT` grant on `audit_log` by design. The call is still wrapped in a try/except (`UndefinedFunctionError`/`InsufficientPrivilegeError`) so a retrain never fails just because its audit write couldn't happen, but this is no longer expected to fire. Still open: the database decides no-shows (`private.housekeeping`) and who to notify (`private.tokens_after_write`), both in `supabase/migrations`, with their own audit trail via `audit_log`; `apps/api`'s notification-delivery path (marking a `notifications` row pushed, deleting a stale `push_tokens` row) still writes no audit row of its own — `private.write_audit()` is now available for that too if it's ever wanted.
- **T4** — A generic `Exception` handler (`app/errors.py`) returns `{"error": "internal_error", "request_id": ...}` with a 500, logging the real exception server-side only; `RequestValidationError` still returns FastAPI's structured 422 (safe to expose — it only echoes back which field failed which constraint, not internals).
- **T5** — `CORSMiddleware` is configured with an explicit allowlist from `settings.cors_allow_origins` (env-driven), never `"*"`, and the origin is never dynamically reflected.
- **T6** — `slowapi.Limiter(key_func=get_remote_address)` rate-limits `/predict` (60/minute) and, more tightly, `POST /admin/retrain` (1 per 10 minutes — a CPU-bound training run, the most expensive single request this service handles); `/health`, `/ready`, and `/metrics` carry no limiter dependency so probe/monitoring traffic is never throttled. Every rate-limited route uses the same route-level-`dependencies=[]` pattern (`app/routes/predict.py`'s comment explains why), so the limit is checked *before* auth resolves — an unauthenticated flood against `/admin/retrain` is throttled too, not just an authenticated one.
- **T7** — see T2.
- **T8** — Every route that can trigger a real DeepSeek API call is rate-limited: `POST /admin/ask` (10/minute), `POST /translate` (30/minute — used both directly and, internally, by the push-delivery path, so this bounds an admin/staff caller, not the internal translation the delivery worker does per notification), `POST /admin/summary/run` (5/minute — admin-triggered and meant to be occasional; the `(org_id, day)` upsert does not itself prevent repeated real DeepSeek calls for the same day, only repeated *storage*). Found and fixed this session: the first version of `/translate` and `/admin/summary/run` shipped with no limiter at all — an authenticated staff/admin could have looped either one with no ceiling on real spend. `GET /admin/summary?lang=` also calls translation, but its cost is naturally bounded by `/translate`'s own cache (same `(report text, lang)` key repeats per org/day), so it was left unlimited rather than adding a redundant control.
- **T9** — Two independent layers, neither trusting the other: `/admin/ask`'s system prompt (`app/ai_ask.py::SYSTEM_PROMPT`) explicitly tells DeepSeek to treat the question as data to analyze, never as instructions, and the API only ever offers it 8 fixed tool definitions to choose from — but even if that were somehow bypassed, `app/analytics.py::call_analytics` independently re-validates the returned function name and every parameter against the same 8-entry whitelist before executing anything, and `org_id` is never a parameter the model (or the caller) can set — it's always the admin's own server-looked-up id. Proven with an injection-shaped prompt in `tests/test_ai_ask.py::test_non_whitelisted_function_never_executes`. Full writeup: `docs/api/deepseek-model-card.md`.

## 5. Residual risk (stated, not hidden)

- **Rate limiting is per-process.** `slowapi`'s default `MemoryStorage` is in-memory per worker process. With N horizontally-scaled replicas (or N uvicorn workers), the effective ceiling on any limited route becomes N times the configured value, since each process counts independently. Upgrade path: `Limiter(storage_uri="redis://...")` for a shared counter — not built for this hackathon.
- **Resolved this session, kept here for the record.** Three gaps previously documented in this
  section landed real fixes on `origin/main` via `supabase/migrations/0031_queueless_api_least_
  privilege.sql` and `0036_write_audit_for_api.sql`, both verified by reading the migrations
  directly (not just trusting a commit message): `queueless_api` now has `SELECT`/`UPDATE
  (pushed_at)` on `public.notifications` plus a real `pg_notify` trigger (`notifications_events`)
  — the delivery poller's degrade-gracefully path should no longer be the active one, and
  `listen_task`'s previously-idle LISTEN connection is now live; the `board_services` RLS gap
  (below) is fixed with the exact policy this document asked for; and `private.write_audit()` — a
  narrow RPC, not a direct `INSERT` grant (that stays locked down on purpose) — gives `apps/api` a
  real way to write to `audit_log`, which `app/routes/admin.py::retrain_once` now calls. The
  degrade-gracefully code paths for all three are left in place (belt-and-suspenders, cheap to
  keep, and a real safety net if a future migration ever narrows access again the way `0030` once
  did) but are no longer expected to actually fire.
- **`board_services` reads were silently RLS-filtered to zero rows in prod** — the original
  finding, now fixed. `0018_queueless_api_role.sql` granted `queueless_api` a table-level `SELECT`
  on `board_services`, but a later migration (`0030_rls_public_tables.sql`) enabled RLS on it with
  a policy naming only `anon, authenticated` — not `queueless_api` — so every read was
  RLS-filtered to nothing regardless of the query. `0031` adds `board_services_api_read` for
  exactly this role. Still worth an explicit pass across every RLS-enabling migration to confirm
  `queueless_api`'s row visibility matches its table grants going forward, rather than finding the
  next one the same way this one was found.
