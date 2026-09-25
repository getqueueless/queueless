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
- **T3** — Partially addressed: `POST /admin/retrain` (`app/routes/admin.py`) does write one `audit_log` row per successful retrain (`actor` = the verified admin's `user_id`, `action='retrain'`, `new` = the full run's metadata) — but `queueless_api` has no `INSERT` grant on `audit_log` as of `0018`, so that insert is wrapped in a try/except on `asyncpg.InsufficientPrivilegeError`, logs loudly, and does not fail the retrain itself. Still open for everything else: the database decides no-shows (`private.housekeeping`) and who to notify (`private.tokens_after_write`), both in `supabase/migrations`, with their own audit trail via `audit_log`; `apps/api`'s notification-delivery path (marking a `notifications` row pushed, deleting a stale `push_tokens` row) still writes no audit row of its own. Flagged as residual below.
- **T4** — A generic `Exception` handler (`app/errors.py`) returns `{"error": "internal_error", "request_id": ...}` with a 500, logging the real exception server-side only; `RequestValidationError` still returns FastAPI's structured 422 (safe to expose — it only echoes back which field failed which constraint, not internals).
- **T5** — `CORSMiddleware` is configured with an explicit allowlist from `settings.cors_allow_origins` (env-driven), never `"*"`, and the origin is never dynamically reflected.
- **T6** — `slowapi.Limiter(key_func=get_remote_address)` rate-limits `/predict` (60/minute) and, more tightly, `POST /admin/retrain` (1 per 10 minutes — a CPU-bound training run, the most expensive single request this service handles); `/health`, `/ready`, and `/metrics` carry no limiter dependency so probe/monitoring traffic is never throttled. Every rate-limited route uses the same route-level-`dependencies=[]` pattern (`app/routes/predict.py`'s comment explains why), so the limit is checked *before* auth resolves — an unauthenticated flood against `/admin/retrain` is throttled too, not just an authenticated one.
- **T7** — see T2.
- **T8** — Every route that can trigger a real DeepSeek API call is rate-limited: `POST /admin/ask` (10/minute), `POST /translate` (30/minute — used both directly and, internally, by the push-delivery path, so this bounds an admin/staff caller, not the internal translation the delivery worker does per notification), `POST /admin/summary/run` (5/minute — admin-triggered and meant to be occasional; the `(org_id, day)` upsert does not itself prevent repeated real DeepSeek calls for the same day, only repeated *storage*). Found and fixed this session: the first version of `/translate` and `/admin/summary/run` shipped with no limiter at all — an authenticated staff/admin could have looped either one with no ceiling on real spend. `GET /admin/summary?lang=` also calls translation, but its cost is naturally bounded by `/translate`'s own cache (same `(report text, lang)` key repeats per org/day), so it was left unlimited rather than adding a redundant control.
- **T9** — Two independent layers, neither trusting the other: `/admin/ask`'s system prompt (`app/ai_ask.py::SYSTEM_PROMPT`) explicitly tells DeepSeek to treat the question as data to analyze, never as instructions, and the API only ever offers it 8 fixed tool definitions to choose from — but even if that were somehow bypassed, `app/analytics.py::call_analytics` independently re-validates the returned function name and every parameter against the same 8-entry whitelist before executing anything, and `org_id` is never a parameter the model (or the caller) can set — it's always the admin's own server-looked-up id. Proven with an injection-shaped prompt in `tests/test_ai_ask.py::test_non_whitelisted_function_never_executes`. Full writeup: `docs/api/deepseek-model-card.md`.

## 5. Residual risk (stated, not hidden)

- **Rate limiting is per-process.** `slowapi`'s default `MemoryStorage` is in-memory per worker process. With N horizontally-scaled replicas (or N uvicorn workers), the effective ceiling on any limited route becomes N times the configured value, since each process counts independently. Upgrade path: `Limiter(storage_uri="redis://...")` for a shared counter — not built for this hackathon.
- **Notification delivery is currently blocked on a missing DB grant/column.** `queueless_api` has no `SELECT`/`UPDATE` on `public.notifications` and no `pushed_at` column exists there yet (`supabase/migrations/0018`) — `apps/api`'s delivery poller detects this, logs it once, and no-ops rather than crash-looping, but delivers nothing until the DB agent adds both. Not a code bug; a cross-team dependency, stated plainly rather than worked around.
- **No audit trail for apps/api's own writes** (T3 above) — marking a notification delivered, push-token deletes, and `/admin/retrain`'s attempted audit row are not currently durable in `audit_log` (the retrain insert is coded but blocked on the same missing grant). All three become one small change once `queueless_api` is granted `INSERT` on `audit_log`.
- **`board_services` reads were silently RLS-filtered to zero rows in prod**, discovered and fixed this session. `0018_queueless_api_role.sql` granted `queueless_api` a table-level `SELECT` on `board_services`, but a later migration (`0030_rls_public_tables.sql`) enabled RLS on it with a policy naming only `anon, authenticated` — not `queueless_api` — so every read was RLS-filtered to nothing regardless of the query. This is an availability/integrity gap, not a confidentiality one (the role could see less than it was granted, not more), but it's the same class of risk as the audit_log gap above: a later migration silently narrowing what an earlier-granted role can actually do. `docs/DECISIONS.md` has the exact SQL fix; `/predict` degrades to a 404 rather than a 500 while it's outstanding. Worth an explicit pass across every RLS-enabling migration to confirm `queueless_api`'s row visibility matches its table grants, rather than finding the next one the same way this one was found.
