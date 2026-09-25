# Judge Q&A

20 likely questions, short true answers. Backed by real files/numbers in this repo, not
talking points — each answer names where to verify it.

## Security

**1. How do you know a JWT is real, not forged?**
`app/auth.py::decode_token` hardcodes `algorithms=["HS256"]` and `audience="authenticated"` —
it never reads the token's own `alg` header, so `alg:none` or a different signing key fails
signature verification and gets 401. `options={"require": ["exp","sub","aud"]}` rejects a
token missing any of those claims too.

**2. Can a patient fake being staff or admin by editing their JWT?**
No. Authorization never reads the JWT's own role/claims — `require_role`/`require_org_role`
do a server-side `SELECT role FROM profiles WHERE user_id = $1` keyed off the verified `sub`,
cached 5s (`role_cache_ttl_seconds`). Proven live: `scripts/attack_test.py`'s
`unknown_profile_forbidden` checks fire a correctly-signed JWT for a user with no `profiles`
row and get 403, not 200.

**3. What was the RLS incident and is it actually fixed?**
`tokens`, `notifications`, `appointments`, `audit_log` had row-level security disabled in prod
while still holding real `SELECT` grants — any signed-in user (tokens: anon, no sign-in at
all) could read every other patient's tickets, notifications, bookings, and the full audit
log. Fixed in `supabase/migrations/0047` (real per-row policies: own-row for patients,
org-staff via `private.is_staff_of()`). Re-verified live after the fix:
`docs/qa/redteam-prod-2026-09-26.md`, 181/182 direct-PostgREST checks passing. The one
accepted exception: `tokens` keeps a documented temporary anon-read policy for two frontend
pages not yet migrated off direct reads (`0048` gives one of them a real RPC).

**4. How do you stop a patient from ever seeing another patient's queue ticket via the API?**
Two independent layers: apps/api's own routes never take a client-supplied `patient_id`
(server derives it from the verified JWT), and — since the incident above — Postgres RLS
itself now blocks any direct table read outside your own row, defense in depth rather than
relying on the API layer alone.

**5. Is the payments webhook spoofable?**
No — `app/payments/signature.py::verify_webhook_signature` does an HMAC-SHA256 over the raw
request body with the Razorpay-configured webhook secret, compared with
`hmac.compare_digest` (constant-time). A bad/missing signature is a 401, checked live in
every red-team run.

**6. What's your worst-case, honestly-stated residual security risk?**
`docs/api/threat-model.md`'s residual-risk section: slowapi's rate limiter and the
`tokens_issued_total` metric checkpoint are both per-process, so N horizontally-scaled
replicas multiply the effective ceiling by N. Named, not hidden — real fix is a shared
Redis-backed counter, not built for this hackathon's single-replica scale.

## Concurrency

**7. Two patients tap "get token" at the same instant for the same service — duplicate
numbers?**
No. `tokens_service_day_number_unique unique (service_id, service_day, number)` is a real DB
constraint — a race surfaces as one request erroring, never a silent duplicate. Proven by
`loadtest/load_test.py`'s concurrent `issue_token` wave + `find_duplicates()` check.

**8. Two front-desk counters both hit "call next" at the same moment — same patient called
twice?**
No. `tokens_one_per_desk unique index (counter_id) where status in ('called','serving')` —
a counter can hold at most one active token, so two racing `call_next` calls can't both claim
the same waiting ticket. `loadtest/load_test.py::run_call_next_race` races 2 real desks and
asserts zero double-calls.

**9. What stops a patient from holding two active tickets for the same service at once?**
`tokens_one_active unique index (patient_id, service_id) where status in
(pending_payment, waiting, called, serving)` — DB-enforced, not app logic.

**10. How is the no-show sweep / retrain job made safe if two server processes run it at the
same time?**
`pg_try_advisory_xact_lock` — transaction-scoped, auto-releases on commit or crash, no manual
unlock path to leak. `retrain_once` (`app/routes/admin.py`) takes this lock before touching
anything; a second concurrent call returns `{"status":"already_running"}` immediately instead
of racing.

## Scalability

**11. What's the real, measured slow query you found, and what fixed it?**
`call_next`'s queue-pop subquery: full seq scan, cost 827 / 1.79ms / 470 buffers →
index scan, cost 17 / 0.04ms / 11 buffers, after adding
`tokens_waiting_queue_idx (org_id, service_id, service_day, lane_rank, priority_at, number)
where status='waiting'`. Measured with real `EXPLAIN (ANALYZE, BUFFERS)` on a 30k-row
fixture — `docs/DECISIONS.md`, 2026-09-26.

**12. What's your caching strategy?**
`/predict` has a hand-rolled 15s TTL cache (`app/ttl_cache.py`), keyed on the full request
(service, doctor, hour, weekday, queue length, counters open) — only successful predictions
are cached, never a 404, so a service that starts existing right after a cached miss is never
masked.

**13. What happens under real concurrent load — do you have numbers?**
`loadtest/load_test.py` is built and its logic self-verified, but not run end-to-end against
a live full stack this session — no safe prod credentials were pulled for a load run outside
the explicit runbook. `loadtest/README.md` has the exact prod command (capped at 200
concurrent, never the local 1000), a duration estimate, and honest p95/error-rate *targets*,
not fabricated measurements.

**14. Does this scale past one server process?**
Partially, by design, and it's stated plainly, not hidden: DB writes/locks (advisory locks,
unique indexes) are correctly multi-replica-safe. Two things are explicitly NOT yet
multi-replica-safe: slowapi's in-memory rate limiter and the `tokens_issued_total` metric
checkpoint (both per-process) — both documented with their exact upgrade path (shared Redis
counter) in `docs/api/threat-model.md`.

**15. How is the monitoring stack itself kept from eating the box?**
Prometheus+Grafana+postgres_exporter+Alertmanager, `mem_limit` per container, ~206MB measured
idle against a 384MB budget (well under the 1GB ask) — `deploy/monitoring/README.md`. Every
host port binds `127.0.0.1` only; postgres_exporter/Alertmanager publish no host port at all.

## ML

**16. How much better is the model than a naive guess?**
81.98% lower MAE than the *fair* baseline (`queue_len_ahead × avg_service_time ÷
counters_open`) — 6.74 min model error vs 37.39 min baseline error, on 20,000 rows, a real
chronological (not random) train/test split. `docs/api/model-card.md`.

**17. "Fair baseline" — fair compared to what?**
An earlier, unfair baseline that ignores `counters_open` entirely scored 39.72 min MAE —
barely worse than the fair one, which made the model look artificially strong. The honest
comparison is against the fair formula, which is also literally what the mobile app's own
client-side fallback computes when the model is unavailable.

**18. What happens when a doctor has too little history for a real prediction?**
Falls back to service-level, not a crash or a made-up number: `predict_with_fallback` only
honors a `doctor_id` when the model was trained with doctor features AND that doctor's
specific hour-bucket clears `min_bucket_samples`, else it falls back to the generic
service-level estimate. Real bucket counts genuinely range 24–49 samples per doctor-hour —
sparsity is real seeded variance, not a bug papered over.

**19. Is the training data realistic, and is it mixed in with real production data?**
No, deliberately kept separate: `scripts/generate_training_data.py` is a synthetic generator
with its own per-service and per-doctor speed multipliers; the seeded 14-day demo history
(`supabase/scripts/seed.sh`) is a different, realistic-looking dataset never fed to the model
— stated explicitly in the model card so nobody presents the seeded history as training data.

**20. Found any real bug in the ML path while building this?**
Yes — `/predict` 500'd in prod on a real `board_services` service the loaded model had never
trained on (`ml_runtime.py`'s `avg_service_time_by_service[service]` was a direct dict index
with no fallback). Fixed to fall back to the mean of known services; caught by
`scripts/prod_smoke.py`, regression-tested in `tests/test_predict.py`.
