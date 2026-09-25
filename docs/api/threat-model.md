# Threat model — apps/api

STRIDE-lite, one page. Scope: the Python FastAPI service in `apps/api` only.

## 1. Assets

- `SUPABASE_JWT_SECRET` — the shared HS256 signing key. Anyone with it can forge any user's identity.
- Patient PII in `tokens` / `profiles` rows (name-adjacent queue state, service visited, role).
- Expo push tokens in `push_tokens` — device-addressable, spammable if leaked.
- The Postgres connection string (`DATABASE_URL` / `DATABASE_URL_DIRECT`) — full read/write to the DB.
- Admin/staff capability — the ability to act as `require_role("staff", "admin")`.

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

## 4. Mitigations (1:1 with the threats above)

- **T1** — `decode_token` (`app/auth.py`) hard-codes `algorithms=["HS256"]` and `audience="authenticated"`; it never reads the token's own `alg` header, so an `alg:none` token or one signed with any other algorithm/secret fails signature verification and is rejected with 401. `options={"require": ["exp", "sub", "aud"]}` rejects tokens missing any of those claims.
- **T2 / T7** — Every request model uses `ConfigDict(strict=True, extra="forbid")` (see `PushTokenIn` in `app/notifications.py`, `PredictIn` in `app/routes/predict.py`), so an extra `role` field is a 422, not silently ignored data. Authorization never reads the JWT's own `role`/`user_metadata`/`app_metadata` or any client-supplied header/body field — `require_role` (`app/auth.py`) derives the role solely from `get_role`, a server-side `SELECT role FROM profiles WHERE user_id = $1` keyed off the verified JWT `sub`, cached in-process for `role_cache_ttl_seconds` (default 5s — the ceiling on how fast a revoked staff member is actually locked out, not instant).
- **T3** — Out of `apps/api`'s scope to fix alone: the database now decides no-shows (`private.housekeeping`) and who to notify (`private.tokens_after_write`), both in `supabase/migrations`, owned by the DB team, with their own audit trail via `audit_log`. `apps/api` is delivery-only — it only marks a `notifications` row as pushed (`pushed_at`) and reads/deletes `push_tokens`; it does not currently write its own audit rows for either. Flagged as residual below.
- **T4** — A generic `Exception` handler (`app/errors.py`) returns `{"error": "internal_error", "request_id": ...}` with a 500, logging the real exception server-side only; `RequestValidationError` still returns FastAPI's structured 422 (safe to expose — it only echoes back which field failed which constraint, not internals).
- **T5** — `CORSMiddleware` is configured with an explicit allowlist from `settings.cors_allow_origins` (env-driven), never `"*"`, and the origin is never dynamically reflected.
- **T6** — `slowapi.Limiter(key_func=get_remote_address)` rate-limits `/predict`; `/health`, `/ready`, and `/metrics` carry no limiter dependency so probe/monitoring traffic is never throttled.
- **T7** — see T2.

## 5. Residual risk (stated, not hidden)

- **Rate limiting is per-process.** `slowapi`'s default `MemoryStorage` is in-memory per worker process. With N horizontally-scaled replicas (or N uvicorn workers), the effective ceiling on any limited route becomes N times the configured value, since each process counts independently. Upgrade path: `Limiter(storage_uri="redis://...")` for a shared counter — not built for this hackathon.
- **Notification delivery is currently blocked on a missing DB grant/column.** `queueless_api` has no `SELECT`/`UPDATE` on `public.notifications` and no `pushed_at` column exists there yet (`supabase/migrations/0018`) — `apps/api`'s delivery poller detects this, logs it once, and no-ops rather than crash-looping, but delivers nothing until the DB agent adds both. Not a code bug; a cross-team dependency, stated plainly rather than worked around.
- **No audit trail for apps/api's own writes** (T3 above) — marking a notification delivered and push-token deletes are not currently recorded in `audit_log`. If judges or the DB team want that, it's a small addition once `queueless_api` is granted `INSERT` on `audit_log`.
