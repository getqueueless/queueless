# Red-team run against prod — 2026-09-26

Target: `https://api.lpu.lol` (real deployed instance). Tool:
`apps/api/scripts/attack_test.py`, run throttled and with the one check
that needs a direct production-database write disabled.

```
API_URL=https://api.lpu.lol SKIP_DB_WRITE_CHECKS=1 ATTACK_REQUEST_DELAY_SECONDS=0.15 \
    SUPABASE_JWT_SECRET=<from /opt/queueless/supabase/.env, never printed> \
    uv run python scripts/attack_test.py
```

**Result: 31/31 passed.**

## What changed for the prod run

- `ATTACK_REQUEST_DELAY_SECONDS=0.15` — the 61-request flood loop that
  proves `/predict`'s 60/minute limiter sleeps 150ms between requests
  instead of firing as a zero-delay burst. Still lands inside the same
  60-second window (proving the limiter), just gentler on a 7.6 GB VPS
  shared with other production apps.
- `SKIP_DB_WRITE_CHECKS=1` — skips check 12 (mint a staff JWT, `INSERT`
  a fake `profiles` row, flip it to `patient` mid-test, prove the JWT
  stops working after the role-cache TTL elapses). That check needs a
  direct `asyncpg` write into `profiles`, which a script has no business
  doing against a real production database. The same TTL-revocation
  logic is proven with a mocked clock in `tests/test_authorization.py`,
  and was already live-verified once against the local stack (this
  session, see `apps/api/scripts/attack_test.py` run history).

## Findings

**One real bug found and fixed before this run**, not by the red-team
script itself but by `scripts/prod_smoke.py` (new this session):
`POST /predict` 500'd on a real `board_services` service_id the currently
loaded model had never trained on (`KeyError` in
`app/ml_runtime.py::predict_with_fallback`). Fixed to fall back to the
mean of known services instead of crashing —
[apps/api/app/ml_runtime.py](../../apps/api/app/ml_runtime.py), covered by
a new regression test in `tests/test_predict.py`. Already committed and
pushed ahead of this red-team run.

**Nothing new found by the red-team script itself.** Every check below
passed on prod, same as it does locally:

```
[PASS] removed_registration_endpoint_returns_404
[PASS] malformed_service_id_rejected
[PASS] injection_payload_never_500["' OR '1'='1"]
[PASS] injection_payload_never_500['"; DROP TABLE tokens']
[PASS] injection_payload_never_500['{"$ne": null}']
[PASS] injection_payload_never_500['../../etc/passwd']
[PASS] unknown_service_id_rejected
[PASS] out_of_range_hour_rejected
[PASS] wrong_type_hour_rejected
[PASS] extra_field_rejected
[PASS] rate_limit_429_eventually
[PASS] rate_limit_retry_after_header_present
[PASS] cors_origin_never_echoed
[PASS] no_auth_header_401[/admin/model]
[PASS] no_auth_header_401[/admin/retrain]
[PASS] no_auth_header_401[/staff/insights]
[PASS] no_auth_header_401[/admin/ask]
[PASS] no_auth_header_401[/translate]
[PASS] no_auth_header_401[/admin/summary/run]
[PASS] no_auth_header_401[/admin/summary]
[PASS] unknown_profile_forbidden[/admin/model]
[PASS] unknown_profile_forbidden[/staff/insights]
[PASS] unknown_profile_forbidden[/admin/ask]
[PASS] unknown_profile_forbidden[/translate]
[PASS] unknown_profile_forbidden[/admin/summary/run]
[PASS] unknown_profile_forbidden[/admin/summary]
[PASS] admin_retrain_role_enforcement_proven_in_pytest
[PASS] ask_injection_defense_proven_in_pytest_not_live
[PASS] org_spoof_has_no_surface
[PASS] role_revocation_ttl_skipped_no_db_write
[PASS] retrain_flood_proven_in_pytest_not_live

31/31 passed
```

## Not covered by this run (honest gaps)

- Role-revocation-after-TTL was not proven live against prod this run
  (see `SKIP_DB_WRITE_CHECKS` above) — only against the local stack and
  in pytest with a mocked clock.
- `/admin/retrain`'s 1-per-10-minutes flood is proven in pytest only
  (`test_rate_limit.py`), never live — triggering it for real would tie
  up the one production retrain slot for 10 minutes over a single
  assertion.
- `/admin/ask`'s prompt-injection resistance is proven in pytest with a
  mocked DeepSeek response, not with a real live adversarial prompt
  against prod (LLM output isn't deterministic; the real guarantee is
  `app/analytics.py::call_analytics`'s independent whitelist check, which
  doesn't depend on what DeepSeek says).

## Addendum, 2026-09-27 — the real hole this run missed

The 2026-09-26 run above only exercised `apps/api`'s own HTTP surface. It
never fired a single request straight at PostgREST (Kong → PostgREST,
`{SUPABASE_URL}/rest/v1/<table>`), which is reachable with just the anon
key or any signed JWT — apps/api's own routes were never the only way in.
That gap is what missed this.

### The finding

Checked directly against the live database (`pg_class.relrowsecurity` +
`information_schema.role_table_grants` on prod, not guessed from
migrations): **`appointments`, `audit_log`, `notifications`, and `tokens`
had row-level security *disabled* while still holding real `SELECT`
grants** for `anon` and/or `authenticated`. RLS-off plus a grant means the
grant applies fully unfiltered:

| Table | Grant holder | Real impact |
|---|---|---|
| `tokens` | `anon` **and** `authenticated` | Every patient's queue ticket (`patient_id`, `org_id`, status, timestamps) readable by anyone at all — **no sign-in required** |
| `notifications` | `authenticated` | Any signed-in user (any real or self-minted JWT, patient role or not) could read every other patient's notification bodies |
| `appointments` | `authenticated` | Any signed-in user could read every other patient's appointment bookings |
| `audit_log` | `authenticated` | Any signed-in user could read the entire admin audit log across every org |

Verified live, minimal-field, single throttled call per table (not a full
row dump):

```
GET /rest/v1/tokens?select=id,patient_id,org_id&limit=1   (apikey: anon, no Authorization)
→ 200 [{"id":"8e62ae28-...","patient_id":"a0d0331a-...","org_id":"94c8a0e1-..."}]
```

`organizations`, `services`, `counters`, `board_services`, `board_counters`,
`push_tokens`, `profiles`, and `counter_services` — the other tables that
also hold a real write grant for `authenticated` — were all confirmed to
still have RLS **enabled**, with policies gating writes to the admin role
or the row's own owner (`private.my_role() = 'admin'`, `id = auth.uid()`,
etc). Not part of this hole.

### The fix

Three migrations from the Hackathon database team, not one:
- **`0063_prod_hotfix_grants.sql`** — a hand-run hotfix already live on
  prod before this addendum was finished: revokes all anon access to
  `profiles`/`appointments`/`notifications`/`audit_log` outright, and
  revokes insert/update/delete (not select) on `tokens` from anon/
  authenticated. This is why the *first* live sweep run already found
  `notifications`/`appointments`/`audit_log` leaking only for `patient`,
  never for `anon` — that half was closed first.
- **`0047_tokens_appointments_notifications_audit_rls.sql`** — the real
  fix: enables RLS on all four tables with actual policies (own-row for
  patients, org-staff for staff/admin via `private.is_staff_of()`).
- **`0048_get_token_status_rpc.sql`** — a purpose-built RPC so
  `apps/web`'s `/t/[id]` page stops needing a raw anon table read.

### Re-test after 0047 — done

Confirmed `relrowsecurity = true` on all four tables directly against
prod (`pg_class`) before re-running, then re-ran the same sweep, same
throttle, against prod:

```
[FAIL] table_sweep_no_cross_identity_read[tokens/anon] -- got 200: [{"id":"0b1b204c-..."}]

181/182 passed
```

**Fixed:** `tokens/patient`, `notifications/patient`, `appointments/
patient`, `audit_log/patient` — all four now correctly return nothing for
another identity's row.

**Still open, on purpose, not a residual bug:** `tokens` keeps an explicit
`tokens_read_anon_temporary` policy (`for select to anon using (true)`) —
0047's own header comment states this is intentionally as wide as the
pre-existing grant, kept only because two frontend pages
(`apps/web/src/app/t/[id]/data.ts` and `/pay/[tokenId]/data.ts`) still do
a raw anon table read for a single token by id. `0048` gives `/t/[id]` a
real RPC to replace it; `/pay/[tokenId]` hasn't moved yet. Confirmed live
— `pg_policies` on `tokens` still lists `tokens_read_anon_temporary` for
role `anon`. Not this session's to remove (apps/web is out of scope
here); flagged so whoever migrates the last caller off direct reads knows
to drop this policy the same day.

Nothing else in the sweep changed: `organizations`/`services`/`counters`/
`board_services`/`board_counters`/`push_tokens`/`counter_services` remain
correctly RLS-gated, as they already were before this whole incident.

### What now catches it permanently

`apps/api/scripts/attack_test.py` gained a direct-PostgREST table access
sweep (section 14): every public table × (anon key, a real-but-unrelated
patient JWT) × select/insert/update/delete, built around filters that can
never match a real row so a still-broken table is caught without
mutating production data. Confirmed live against prod *before* the fix —
it correctly reproduces exactly the five broken checks matching the table
above (`tokens` for both anon and patient, `notifications`/`appointments`/
`audit_log` for patient) and nothing else:

```
[FAIL] table_sweep_no_cross_identity_read[tokens/anon] -- got 200: [{"id":"0b1b204c-..."}]
[FAIL] table_sweep_no_cross_identity_read[tokens/patient] -- got 200: [{"id":"0b1b204c-..."}]
[FAIL] table_sweep_no_cross_identity_read[notifications/patient] -- got 200: [{"id":"79c60015-..."}]
[FAIL] table_sweep_no_cross_identity_read[appointments/patient] -- got 200: [{"id":"573d3738-..."}]
[FAIL] table_sweep_audit_log_invisible[patient] -- got 200: [{"id":1}]

176/182 passed
```

(A 6th failure this run, `no_auth_header_401[/admin/retrain] -- got 429`,
is self-inflicted test interference, not a finding — `/admin/retrain` is
limited to 1 request per 10 minutes per IP, and this script was run
against prod three times in under 20 minutes while building the sweep,
each run touching that route twice. Resolves on its own once 10 minutes
pass between runs.)

### Re-test after 0046 — pending

*(To fill in once `supabase/migrations/0046` lands on `origin/main` and
this session re-runs the sweep against prod.)*
