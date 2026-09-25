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
