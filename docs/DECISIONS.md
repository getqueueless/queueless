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
- 2026-09-25 (for web): `apps/web`'s counter screen (per JUDGE_NOTES "Web app" section) calls
  `mark_done`, `mark_no_show`, and `transfer_token`. None of those exist -- the real RPC names
  are `complete_token` and `skip_token`; there is no no-show RPC at all (no-shows are set only by
  the automatic housekeeping job on a timer, never by staff action) and no `transfer_token`
  (moving a ticket to a different desk isn't in the spec). `call_next` and `recall_token` do
  match. Flagging this now since it's a real integration break, not a documentation gap.
- 2026-09-25: Email OTP's confirmation email uses the built-in GoTrue body template with the
  code only in the subject line, not a custom HTML body. `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`
  is always fetched over HTTP (confirmed in GoTrue's templatemailer source) -- there's no way to
  inline literal HTML there, and this stack has no static file host to serve a custom template
  from. Adding one is a separate, larger task if a fully custom body ever matters.
- 2026-09-25: `GOTRUE_MAILER_AUTOCONFIRM` default flipped from a hardcoded `"true"` to
  `${MAILER_AUTOCONFIRM:-false}` so the VPS (real SMTP configured) actually requires the emailed
  code. Local `.env` must set `MAILER_AUTOCONFIRM=true` (added to `.env` and `.env.example`) or
  local signups will hang unconfirmed against the noop mailer.
- 2026-09-25: The local Docker stack (compose project `queueless`) is shared across whatever
  sessions run on this machine against this checkout -- found committed "QA Admin"/"QA Staff"
  rows in `audit_log` from a concurrent session's own testing, not mine. Fixed `072_audit_triggers`
  which asserted absolute table-wide `count(*)` and broke against that unrelated data; every
  count-based assertion must scope by the specific `entity_id`/`token_id`/etc. the test itself
  created, never a bare table-wide count. Applies to any future test too.
- 2026-09-25 (mobile, email OTP): switched patient auth from email+password to
  `signInWithOtp`/`verifyOtp` per `supabase/README.md`'s "Patient auth: email OTP" section
  (landed mid-session). `sign-in.tsx` renamed to `password-fallback.tsx` (kept reachable, not
  the default screen) and `sign-up.tsx` deleted — OTP's `shouldCreateUser: true` covers both.
  `lib/errors.ts`'s `AUTH_MESSAGES` swapped from password codes to `otp_expired`,
  `over_email_send_rate_limit`, `over_request_rate_limit`.
- 2026-09-25 (mobile, OTP verification status): **not verified end-to-end against a live SMTP
  relay** — this machine has no path to one. Two of the three GoTrue error codes ARE verified
  for real against the running local stack (`curl` directly against `supabase-auth`, not just
  docs): a second `signInWithOtp` to the same address inside ~59s returns
  `{"code":429,"error_code":"over_email_send_rate_limit","msg":"...after 59 seconds"}` — this is
  GoTrue's built-in per-address send cooldown, unrelated to the 30/hour
  `GOTRUE_RATE_LIMIT_EMAIL_SENT` abuse cap; the client's resend cooldown is set to 65s (not the
  spec's suggested 60s) specifically because 60s doesn't comfortably clear a measured ~59s
  window. `verifyOtp` with a bogus 6-digit code returns
  `{"code":403,"error_code":"otp_expired","msg":"Token has expired or is invalid"}` — confirmed.
  `over_request_rate_limit` could NOT be tested: `GOTRUE_RATE_LIMIT_HEADER` is empty locally
  ("IP limits off (local)" per `docker-compose.yml`), so per-IP limiting is disabled in this
  environment entirely; it only activates on the VPS behind Cloudflare.
  The full round trip (real code emailed, received, entered, session issued) is **not**
  verified: local `MAILER_AUTOCONFIRM=true` confirms the email at signup time and — confirmed by
  querying `auth.users.confirmation_token` directly, which came back blank — GoTrue never
  generates a code to verify at all in that mode, so there's structurally nothing to test against
  locally without flipping that setting. Deliberately did not restart the shared local
  `supabase-auth` container to flip it, since three other sessions may depend on its current
  config mid-build. Also tried the deployed instance directly: `sb.lpu.lol` resolves and answers
  real Supabase/Kong responses (confirmed via `curl`), but the only `ANON_KEY` available on this
  machine (the local dev one, from this worktree's own `supabase/.env`) gets a `401 Unauthorized`
  from it — it's a different deployment's key, as expected, and no prod key is available here.
  Net effect: keeping `password-fallback.tsx` reachable per the task's own contingency plan
  until a real round trip is confirmed by whoever has SMTP/prod credentials.
- 2026-09-25 (mobile): `api.lpu.lol` DOES resolve and answer now (`GET /health` → `200
  {"status":"ok"}`, `GET /predict` → `405` as expected for a POST-only route) — this contradicts
  the OTP task prompt's claim that it "does not resolve yet," which was accurate when written
  but is now stale; time passed between that check and this session picking up the task.
- 2026-09-25 (mobile): `profiles` has no RLS/grant migration yet for owner-column updates
  (`full_name`/`phone`) — checked every migration file through `0027_housekeeping.sql`, none
  touch `profiles` policies or grants. `name-entry.tsx` calls
  `supabase.from('profiles').update({ full_name })` anyway (correct against the documented
  design) but the write is wrapped in try/catch — on failure the name is stashed in
  `localStorage` (`PENDING_NAME_KEY`, exported from `name-entry.tsx`) and the screen still
  proceeds into the app regardless, per the task's own instruction that a missing display name
  is cosmetic and must never gate taking a token. `(app)/_layout.tsx` retries that one pending
  write once on every future boot until it succeeds, then clears the stash. Once RLS lands,
  this starts succeeding with no code change needed.
