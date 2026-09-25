# Decisions log

One line per deviation from the plan/spec, with why.

- 2026-09-25: Added `TENANT_MAX_CONCURRENT_USERS: 2000` to the realtime service in
  `supabase/docker-compose.yml`. The kit's `TENANT_MAX_EVENTS_PER_SECOND` was already set
  but this sibling tenant-seeding variable was missing, leaving the realtime tenant on its
  default 200-connection cap. Added to match the spec's stated invariant and avoid a silent
  connection cap on demo day.
- 2026-09-25: `check_in`'s priority_at uses `greatest(slot.starts_at, now())`, not the
  `least(...)` the spec's formula literally names. The spec's own prose in the same sentence
  says early check-in should count from the booked slot time and late check-in from actual
  arrival ("no free head start for showing up early", "lateness isn't rewarded either") --
  that behavior is `greatest()`: early (now < starts_at) picks starts_at, late (now >
  starts_at) picks now. `least()` would do the opposite of both stated rules. Implemented the
  described behavior over the literal formula.
- 2026-09-25 (mobile): wrote `docs/API_CONTRACT.md` before `apps/api` had published any route
  for push/predict — proposed `POST /push/register` and `GET /predict?service_id=` per the
  original brief, guessed dev port 8001 (nothing pins one in `apps/api`). Both calls are
  optional/non-blocking at runtime either way.
- 2026-09-25 (mobile): `lib/errors.ts` wraps `@queueless/db`'s real `errorInfo()` instead of
  hand-rolling a map, since `packages/db/src/errors.ts` landed before mobile needed it.
- 2026-09-25 (mobile): first `pnpm install` in the repo required `pnpm approve-builds
  unrs-resolver` to run at all; that call wrote `allowBuilds`/`minimumReleaseAgeExclude`
  entries into root `pnpm-workspace.yaml` as an unavoidable side effect of pnpm's own
  supply-chain policy, not a deliberate scope change.
- 2026-09-25 (mobile): `apps/mobile/app.json` scheme changed from the scaffold default
  `mobile` to `queueless` to match `supabase/.env.example`'s `ADDITIONAL_REDIRECT_URLS`.
- 2026-09-25 (mobile): `services`/`board_services`/`appointment_slots`/`appointments`/
  `notifications` column names beyond what `supabase/README.md` documents are best-effort
  assumptions (migrations hadn't landed while mobile was built) — see inline comments in
  `app/(app)/(tabs)/index.tsx`, `app/(app)/token/[id].tsx`, `app/(app)/(tabs)/appointments.tsx`,
  `app/(app)/(tabs)/history.tsx`, and `app/(app)/_layout.tsx` for exactly what each screen
  assumes. Reconcile against the real migration once it ships.
- 2026-09-25 (mobile): `appointments.tsx` matches "is this slot mine" by `slot_id` first,
  falling back to `service_id + starts_at`, treating only `status === 'booked'` as an active
  booking — an assumption pending real `appointments` columns.
- 2026-09-25 (mobile): `notifications` schema beyond `patient_id` isn't documented — assumed
  `id`, `kind`, `read_at`, `token_id`, no title/body columns; banner copy is derived from
  `kind` via a substring match (`called`/`almost`) instead of reading text off the row.
- 2026-09-25 (mobile, reconciled): `supabase/migrations/0001-0006` landed — the three
  assumptions above were checked against them and two were wrong, both fixed: `board_services`
  is `(service_id, day)`-keyed with no `open_counters` column (Home now filters by today and
  derives open counters from `counter_services` joined to `counters.state`); `notifications`
  does have `title`/`body` (banner now uses them directly, not a `kind` guess). Also caught:
  `appointment_status` has no `'done'` value, so History's filter was silently falling back to
  showing active bookings — fixed to `cancelled`/`no_show`. RPC functions themselves
  (`issue_token`, `my_queue_status`, etc.) still aren't implemented on `origin/main` as of this
  reconciliation, so the *_call_ contracts in `supabase/README.md` remain unverified against
  running code — table-level reads are now schema-accurate, RPC calls are not yet testable.
- 2026-09-25: `push_tokens`/`token_notifications`/`queueless_api` role (0016-0018) aren't in the
  original spec -- added on direct request to give `apps/api` its own least-privilege Postgres
  identity instead of connecting as `postgres`. `token_notifications` lives in schema `private`
  (never exposed via PostgREST) since only `queueless_api` ever touches it directly; `push_tokens`
  lives in `public` with owner-only RLS since the mobile client registers its own row directly.
