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
- 2026-09-25: Live RLS gap, narrowing but not closed. `organizations`, `services`, `counters`,
  `board_services`, `board_counters` (0030) and `push_tokens` (0016) now have RLS; `profiles`,
  `tokens`, `appointments`, `appointment_slots`, `counter_services`, `notifications`, and
  `audit_log` still don't, and no migration has revoked Postgres's default privilege grants on
  them either. Until that lands, the live `anon` key — shipped inside the public web and mobile
  bundles — can `select`/`insert`/`update`/`delete` on `tokens` and `profiles` (including setting
  `role='admin'` on itself) directly through PostgREST, bypassing every RPC's checks. This is
  real and live on the deployed instance today, seeded or not. Closing it is a full RLS-policy
  pass across the remaining tables, tracked as its own piece of work, not bundled into whatever
  task happens to touch the schema next.
- 2026-09-25: Admin dashboard's "today" for the `board_services` lookup is computed client-side
  as `new Date().toISOString().slice(0,10)` (UTC), not the org's `Asia/Kolkata` day the backend
  computes everywhere else via `private.service_day`. They diverge for about 5.5 hours a day
  (roughly 00:00-05:30 IST), during which the dashboard queries the wrong day's board row. This
  is an `apps/web` fix, out of scope for the DB side.
- 2026-09-25 (mobile): the exact same UTC-vs-`Asia/Kolkata` bug above was independently present
  in `(app)/(tabs)/index.tsx`'s own `todayDateString()` (used to filter `board_services` by
  `day`) — caught by reading this file's own log entry above, fixed the same way
  (`toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'})`), hardcoded to the org's default
  timezone since the mobile client doesn't otherwise know `org_id` (single-org hackathon demo).
- 2026-09-25 (mobile, MedWin redesign): derived `apps/mobile/DESIGN.md` independently from
  `~/code/design-ref/medwin/` rather than waiting on `apps/web/DESIGN.md`'s own MedWin pass —
  checked again at the end of this session (via `head`/`git log` on `origin/main`) and
  `apps/web/DESIGN.md` still describes the old teal/Inter "calm clinical" system, unchanged.
  No reconciliation was possible or needed yet; re-check next time either file is touched.
- 2026-09-25 (mobile, MedWin redesign): while restyling, three of the six restyling agents
  independently found and fixed the same class of pre-existing bug: `primary` (`#0cb7d6`) used
  as a small text color (`NotificationBanner`'s title, `token/[id].tsx`'s counter-banner label
  and active progress labels, `PriorityInfoCard`'s heading, Settings' "Active" pill, two link
  colors in Appointments/OTP) — all measure under WCAG AA's 4.5:1 at body/caption size (~2.4:1
  on white). Fixed in place as part of the restyle per the brief's own non-negotiable
  accessibility rule, not filed as separate "noticed, not touched" items, since the rule that
  would have required touching them anyway was explicit in every agent's own instructions.
- 2026-09-25 (mobile): `pnpm --filter mobile exec expo start --web` fails to bundle at all --
  pre-existing, unrelated to the redesign, verified by direct testing while trying to take the
  screenshots this task asked for. Two layers: (1) `expo-sqlite`'s web worker imports a `.wasm`
  file directly and Metro's default `resolver.assetExts` doesn't include `wasm` -- fixed with a
  new `apps/mobile/metro.config.js` pushing `'wasm'` onto that list, a standard, narrowly-scoped
  fix. (2) Underneath that, Expo Router's static-page serializer throws `AssertionError: Worker
  chunk not found for: .../expo-sqlite/web/worker.ts` while resolving the same web worker -- this
  is deeper (Metro's chunk-graph/serializer, not a config value) and didn't get fixed;
  `apps/mobile/src/lib/supabase.ts` imports `expo-sqlite/localStorage/install` unconditionally on
  every platform including web, and every screen transitively imports it, so this blocks
  `expo start --web` entirely, on any route. Did not chase it further -- pre-existing dependency/
  tooling incompatibility, not a redesign concern, and no real device or emulator is available in
  this environment either. Net effect: could not produce live screenshots for this task's final
  report; said so plainly rather than fabricating them. A real fix, if this matters later, is
  most likely a web-specific `localStorage` shim in `lib/supabase.ts` that skips `expo-sqlite`
  entirely on `Platform.OS === 'web'` (the browser already has a native `localStorage`,
  `expo-sqlite`'s polyfill is redundant there) -- untried, flagged for whoever needs
  `expo start --web` working next.
- 2026-09-26 (apps/api): **`queueless_api` can't actually read `board_services` in prod --
  DB agent action needed.** `0018_queueless_api_role.sql` granted `select on public.board_services
  to queueless_api` at the table level, but `0030_rls_public_tables.sql` (landed later) enabled
  RLS on that table with `create policy board_services_read ... to anon, authenticated using
  (true)` -- `queueless_api` isn't in that role list, so RLS silently filters every one of its
  selects to zero rows regardless of the `WHERE` clause. This was masked locally because
  `apps/api/scripts/dev_db.py`'s test fixture has no RLS at all. `apps/api`'s own `/predict`
  existence check degrades gracefully today (returns 404, doesn't crash), but it's a false 404 on
  every real service_id in prod right now. Needed, either one:
  ```sql
  create policy board_services_api_read on public.board_services
    for select to queueless_api using (true);
  ```
  or add `queueless_api` to the existing `board_services_read` policy's role list. Same class of
  gap likely applies to any other table where a later RLS-enabling migration didn't re-check
  `0018`'s role list -- worth an explicit pass, not just this one table.
- 2026-09-26 (mobile, push): push registration now writes straight to `public.push_tokens` through
  the Supabase client (`src/lib/push-tokens.ts`, used by `lib/notifications.ts`). It upserts with
  `onConflict: 'expo_token'`, so re-registering an unchanged token is a no-op, not a 23505. The
  old `POST /push-tokens` call, `device_id` and its `localStorage` key are gone.
  `scripts/check-push-tokens.mjs` runs that same module against a live Supabase with two real
  sessions. It passed 6/6 against the local stack and against production:
  - save;
  - save again;
  - a second account saving the same token gets `42501`;
  - the second account's delete leaves the row alone;
  - the owner's delete works;
  - the row is gone afterwards.
  A row saved on prod was also confirmed with `psql` inside `supabase-db`, and confirmed gone after
  `deletePushToken`, the call sign-out makes. Token rotation re-runs the same upsert. Stale rows
  need no client cleanup: `apps/api` deletes a token when Expo answers `DeviceNotRegistered`.
- 2026-09-26 (mobile, push, known gap): **multi-account push per device.** `expo_token` is
  globally unique, and the owner-only RLS `using` clause only covers rows you already own.
  - **The failure.** If a phone changes hands without a sign-out (reinstall, cleared data, a
    failed cleanup delete), the new account's upsert hits the old owner's row and Postgres rejects
    it with `42501`. The row is not reassigned.
  - **Client handling.** The client catches that code and logs
    `[push] token belongs to a different account on this device`. Pushes keep going to the old
    owner until they sign out there, or Expo reports the token dead.
  - **What limits it.** Sign-out deletes this device's row first, which keeps the case rare.
    Patients demo on their own phones.
  - **The real fix, not done.** A `security definer` RPC that re-homes a token to the caller.
- 2026-09-26 (mobile, push, blocker): **no device can mint an Expo push token yet.**
  `getExpoPushTokenAsync()` throws `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` without
  `extra.eas.projectId`, and `app.json` has none. Creating one needs `eas init`, which needs
  `eas login`, and both were out of bounds for this task. Until someone runs it, registration
  degrades to "no token" everywhere; the Realtime + local-notification path is unaffected.
  `Notifications.addPushTokenListener` also throws in Expo Go on Android (SDK 53+), so the
  rotation listener is wrapped in try/catch.
- 2026-09-26 (mobile, prod): `apps/mobile/.env` (gitignored) now points at `https://sb.lpu.lol` and
  `https://api.lpu.lol`. The prod anon key came from the deployed `/opt/queueless/supabase/.env` on
  the VPS: a read-only ssh that extracted only the `ANON_KEY` line and never printed it. Its JWT
  decodes to `role: anon`, and `auth/v1/health` and `rest/v1/services` both answer 200 with it.
  Nothing else was read from that file.
- 2026-09-26 (mobile, theme): `theme.ts` had neither of BRAND.md's AA cyans. What changed:
  - **TwoToneHeading.** Its accent word used `#0cb7d6` (2.40:1 on white, failing even large text).
    It now uses a new `primaryDisplay` token (`#0a95ae`, 3.55:1, large text only).
  - **Home card numbers.** These are 18%-opacity watermarks, so decorative. They were retinted to
    the same token for consistency.
  - **Light `onPrimary`.** Changed from white to ink `#252525` (6.39:1), because BRAND.md rules
    out white on cyan at every size.
  - **Why not web's approach.** Web uses a deep `#087589` button with white text instead. Both
    pass AA. Mobile keeps the bright MedWin fill, which is a one-token change.
- 2026-09-26 (mobile, icons): `icon.png` is `apps/web/src/app/icon.svg` rendered full bleed.
  - **icon.png.** `rx` is dropped and it has no alpha: launchers apply their own mask, and iOS
    rejects alpha. `favicon.png` keeps the rounded tile.
  - **Adaptive and monochrome layers.** Both are the inverse mark on transparent, at
    `translate(29.25 32) scale(2.75)` on the 108 dp canvas. The farthest opaque pixel measures
    32.1 dp from the centre, inside the 33 dp safe circle. The redundant background PNG is dropped
    for a solid `#1a3237`, and the splash uses the same colour.
  - **iOS `expo.icon` (best effort).** The brand mark layer on a slate-teal fill. It was not
    compiled, because Icon Composer is macOS-only, and the preview APK is Android-only anyway.
  - **Left in place.** The unreferenced template images (`expo-badge*.png`, `expo-logo.png`,
    `logo-glow.png`, `react-logo*.png`, `tabIcons/`, `tutorial-web.png`) are left for a cleanup
    pass.
- 2026-09-26 (mobile, web): this supersedes the web-bundling entry above; the fix it proposed
  is in.
  - **The fix.** `src/lib/storage-polyfill.ts` holds the `expo-sqlite` localStorage install, and
    `storage-polyfill.web.ts` is empty. The split is by platform file, not a runtime `if`, because
    Metro bundles every static import whatever its condition. On web, supabase-js `storage` is left
    unset: it uses `window.localStorage` in the browser and memory during static rendering.
    `metro.config.js`'s wasm rule is no longer needed and is deleted. `web.output` stays
    `"static"`.
  - **Results.** `expo export -p web` renders all 25 routes, the android export still bundles
    expo-sqlite, and `/` and `/password-fallback` render in a real browser.
  - **Web-only gaps, left alone** (the web build is a dev and screenshot target):
    - "Cancel ticket" does nothing on web, because react-native-web's `Alert.alert` is a no-op.
    - `/predict` is blocked by CORS from a browser origin, so web always shows "estimate".
    - The web tab bar overlaps the Home heading.
- 2026-09-26 (mobile, found on prod): **History and Appointments showed other patients' rows.**
  Both screens assumed RLS scoped `tokens`/`appointments` to the caller, but prod has RLS off on
  `tokens`, `appointments`, `notifications` and `profiles` (`relrowsecurity = f`). A brand-new
  account's History listed all 1275 finished tokens (87 KB). Both reads now filter on
  `patient_id` themselves (the response dropped to 1.1 KB, own rows only), and History's
  unfiltered `select('*')` fallback is gone. The DB-side gap from the 2026-09-25 entry above still
  stands: the anon key can read those tables directly.
- 2026-09-26 (mobile, found on prod, **DB/deploy action needed**): **returning patients cannot
  sign in by email.** Checked by reading the real emails prod sent.
  - **Where the code is.** A first sign-in gets the confirmation template, whose subject carries
    the code (`GOTRUE_MAILER_SUBJECTS_CONFIRMATION`).
  - **What returning users get.** An already-confirmed user gets the magic-link template: "Your
    sign-in link", a link only, with no 6-digit code. The app's code screen has nothing to accept.
  - **The link is broken too.** It points at `https://sb.lpu.lol/verify` without the `/auth/v1`
    prefix, and returns 404. The same token works at `/auth/v1/verify`.
  - **Fix.** Set `GOTRUE_MAILER_SUBJECTS_MAGIC_LINK="{{ .Token }} is your WaitWise code"`, the
    same pattern as confirmation. Also fix the mailer URL paths (`GOTRUE_MAILER_URLPATHS_*` or
    `API_EXTERNAL_URL`).
- 2026-09-26 (mobile, found on prod, **DB action needed**): **Realtime delivers nothing.** The
  `supabase_realtime` publication exists but holds no tables; no migration ever runs
  `alter publication supabase_realtime add table ...`.
  - **Effect.** Every `postgres_changes` subscription stays silent: token position, Home waiting
    counts and notification banners. Screens update only on refetch (reconnect, foreground,
    reload).
  - **Test.** A ticket was cancelled through `cancel_token` while its token screen and Home were
    open. Neither changed in 10 s, and a reload showed the new count.
  - **Fix.** Add `public.tokens`, `public.board_services` and `public.notifications`, plus whatever
    `apps/web` subscribes to, to the publication.
- 2026-09-26 (mobile, prod test data): three test patient accounts (plus-addressed aliases of a
  team inbox) were created on prod to verify OTP, name entry and push. One Pharmacy ticket
  (PHA-002) was taken and then cancelled. `push_tokens` was left empty.
- 2026-09-26 (db): `0031_queueless_api_least_privilege` + `0032_notifications_client_writes`. Resolves
  the apps/api request above (`board_services_api_read` landed, plus `services_api_read` and
  `push_tokens_api_delete`: the `push_tokens` delete grant from 0018 had no delete policy, so
  apps/api's dead-device cleanup deleted nothing, silently). Test `105` counts real rows as
  `queueless_api` rather than checking grants, so the next RLS rollout that forgets this role fails
  loudly. Choices that differ from the task prompt, on purpose:
  - NOTIFY uses channel `notifications_events` with JSON `{id, patient_id, body}`, which is what
    `apps/api/app/notifications.py` `listen_task` already parses. The prompt's `notifications_new`
    channel with a bare id has no listener. `body` is capped at 1,000 characters: an uncapped
    10,000-character body made `pg_notify` raise `payload string too long`, which fails the insert
    and the `call_next` behind it (the called body embeds the counter name).
  - `profiles` is granted `select (id, org_id, role)` only, all apps/api reads; `full_name` and
    `phone` stay unreadable.
  - 0031 sets `pushed_at = now()` on every existing row in its own transaction. Without that the
    5-second poller pushes the whole backlog (646 of 646 rows on a seeded DB). A later migration
    would race the poller.
  - 0031 revokes public execute on its new trigger function. 0029's `alter default privileges in
    schema private revoke execute on functions from public` does nothing in Postgres (per-schema
    defaults can only add to the global ones), so every new `private` function is callable by
    `public` until revoked. Test 105 sweeps for this; 0029's line itself is left as is.
  - 0032 (approved separately): `notifications` is still RLS-off with Supabase's default grants,
    so the public anon key could insert a notification for any patient (now pushed to their phone)
    or reset `pushed_at` to replay old ones. Revoked insert/update from `anon`/`authenticated`,
    granted `update (read_at)` back for the app's mark-read. Reads and deletes stay open until the
    RLS pass.
  - `migrate.sh` loads `supabase/.env` the way `seed.sh`/`demo-reset.sh`/`smoke.sh` do, so
    `QUEUELESS_API_DB_PASSWORD` can live there. Two variables now set one password
    (`QUEUELESS_API_PASSWORD` when 0018 creates the role, `QUEUELESS_API_DB_PASSWORD` when 0031
    resets it; the second wins). Left as the prompt asked; merging them is a team call.
  - Test 105 grants `postgres` SET on `queueless_api` and `queueless_api` usage on `extensions`
    (where pgTAP lives) inside its own rolled-back transaction, not in a migration.
  - Not changed: `queueless_api` still holds `select, insert` on `private.token_notifications`,
    unused since 1d271f3. apps/api's `/admin/retrain` wants `insert` on `audit_log`; not granted,
    it was outside this task's list.
- 2026-09-26 (mobile): building the patient/staff/admin role-routed app, found (and flagged
  separately, not fixed here -- out of `apps/mobile`'s scope) that `profiles` and `tokens` have
  no RLS on prod at all as of migration 0032 -- `anon` can currently read every profile
  (role/org_id/full_name) and every token (code/patient_id) with no login, and has an UPDATE
  grant on `profiles` (verified non-destructively: a PATCH against a nonexistent id returned
  `200 []` instead of a permission error), meaning anyone can set their own `role` to `'admin'`
  with one unauthenticated request. `useRole()` (`src/lib/use-role.ts`) reads `profiles.role` for
  UI routing only and defaults to `'patient'` on any failure -- it is not, and was never meant to
  be, the real authorization boundary; every actual staff/admin write still goes through an RPC
  or an RLS-scoped table that checks role server-side independently. Still, this needs fixing
  before judging -- a task is queued for whoever runs the DB session next.
- 2026-09-26 (mobile): Google sign-in (`src/lib/google-auth.ts`) is built client-side (PKCE,
  `signInWithOAuth` + `expo-web-browser`, redirect `queueless://auth/callback`) but GoTrue has no
  Google provider configured on `origin/main` (`supabase/docker-compose.yml`/`.env.example` have
  no `GOTRUE_EXTERNAL_GOOGLE_*`) -- that needs a real Google Cloud OAuth client, which only a
  human can create, plus `queueless://**`/`exp://**` in GoTrue's redirect allow-list for it to
  work from Expo Go during dev. Until that lands, the button shows a mapped "Google sign-in
  isn't set up yet" error instead of crashing.
- 2026-09-26 (mobile): the "Settings: language EN/HI/PA -> profiles.language RPC" ask has no
  matching column or RPC anywhere in `supabase/migrations/` (checked all 32 files) -- scoped
  down to a local-only preference (same `localStorage` polyfill the theme preference already
  uses), not synced to the server. Flagging rather than inventing a fake RPC call.
- 2026-09-26 (mobile): the admin dashboard has no `admin_service_today`/`admin_counter_today`/
  `admin_hourly` SQL views to read -- none exist in any migration. `apps/web`'s own admin
  dashboard (`_lib/use-queue-stats.ts`) already solved this the same way: compute the stats
  client-side from `tokens`/`board_services` reads. Mobile's dashboard does the same rather than
  inventing a second approach.
- 2026-09-26 (mobile): admin "staff management" is scoped to *promoting/demoting an existing
  profile* via `set_member_role` (which takes a `uuid`, not an email) -- not "invite new staff by
  email." Creating a brand-new auth user needs `auth.admin.createUser()`, which only works with
  the `service_role` key; `apps/web` has this because it can run that call inside a Next.js
  server route (`api/admin/staff/route.ts`) that never ships the key to the browser. Mobile has
  no server component, so embedding that key in the app bundle is not an option -- an admin can
  promote/demote whoever already has an account, but inviting someone new by email has to happen
  from the web admin console instead.
- 2026-09-26 (apps/api, DeepSeek features): three real DB-side asks, none of which exist in
  `supabase/migrations` as of this writing.
  1. **`analytics.*` functions** (`no_shows_by_service`, `avg_wait_by_hour`, `busiest_counters`,
     `tokens_per_day`, `service_time_trend`, `wait_vs_predicted`, `peak_hours`, `lane_mix`) --
     built against assumed signatures (documented in `app/analytics.py`), every one
     `(org_id uuid, ...params) returns table(...)`, `org_id` always first and never a
     client/model-suppliable param. Fixture versions (real SQL, not mocked) live in
     `scripts/dev_db.py` so `POST /admin/ask` and the daily summary are genuinely exercised
     locally. Reconcile signatures once the DB agent lands the real functions --
     `app/analytics.py`'s `ANALYTICS_FUNCTIONS` dict is the one place to update.
  2. **`ops_summaries` table** for the daily ops report:
     ```sql
     create table public.ops_summaries (
       id uuid primary key default gen_random_uuid(),
       org_id uuid not null,
       day date not null,
       report text not null,
       ai_generated boolean not null default true,
       aggregates jsonb not null,
       created_at timestamptz not null default now(),
       unique (org_id, day)
     );
     grant select, insert, update on public.ops_summaries to queueless_api;
     ```
     `app/summary.py` degrades gracefully (logs once, still returns the computed report to the
     caller) if this is missing -- writes just don't persist yet.
  3. **`profiles.language` column** for push/report translation -- confirmed independently by
     the mobile session's entry above (same file, same conclusion, different feature). Needed:
     `alter table public.profiles add column language text;` (values `'hi'`/`'pa'`/null=English).
     `app/notifications.py`'s `_patient_language` degrades to "no translation" until it lands.
- 2026-09-25 (web, MedWin redesign): **light is the default theme, applied literally.** A
  first-time visitor with nothing stored gets light, even if the OS prefers dark. Tested with
  colorScheme "dark": `data-theme` was absent and the body background was `rgb(255, 255, 255)`.
  - **How it works.** The inline `THEME_SCRIPT` in `layout.tsx`'s `<head>` reads localStorage
    `queueless-theme` and accepts only `"dark"` or `"light"`. It sets `<html data-theme>` before
    first paint, and `<html>` has `suppressHydrationWarning`. `ThemeToggle` writes the same key.
  - **Stored choice wins.** A returning visitor's choice applies everywhere, including pages
    with no toggle. `/kiosk`, `/login` and `/` all stayed dark after hydration.
  - **No OS seeding.** The brief allowed `prefers-color-scheme` as a first-visit default. It is not
    used anywhere, so "light is the default" means exactly that. Recorded in `DESIGN.md`'s "Theme"
    section.
  - **The TV board is the exception.** It pins its own slate-teal palette, theme-color and dark
    color-scheme, and ignores the stored theme.
- 2026-09-25 (web, MedWin redesign): **font split.** Poppins (400/700, `--font-display`) is used for
  headings everywhere and for body text on the public screens (`/`, `/login`, `/kiosk`, `/t/[id]`),
  where sizes are large enough for it to read cleanly. Inter stays the body and UI font on
  `/counter` and `/admin/**`, whose dense tables and 12-13px labels read faster in it. MedWin itself
  is Poppins-only. Mono (JetBrains Mono) is kept for token codes so OPD-014 always has the same
  shape.
- 2026-09-26 (apps/api): **the three DeepSeek gaps above are resolved** -- a `git pull --rebase`
  mid-task surfaced that the DB agent read this file, `app/analytics.py`, `app/summary.py`, and
  `apps/api/scripts/dev_db.py`'s fixture directly and shipped `supabase/migrations/0033_
  analytics_schema.sql` (all 8 functions, exact param order/types, `org_id` first and
  server-checked via `private.check_analytics_org`), `0034_ops_summaries.sql` (exact column
  match, `queueless_api` granted select/insert/update), and `0035_profiles_language.sql` --
  matching this session's own assumed contract, not the original task wording, specifically
  *because* it was already landed and already tested. Also resolved in the same pass: the
  `board_services` RLS gap from the earlier entry above (`0031_queueless_api_least_privilege.sql`
  adds exactly the `board_services_api_read` policy this file asked for), and the `audit_log`
  grant gap -- not a direct `INSERT` grant (stays locked down on purpose) but a narrow
  `private.write_audit()` function (`0036_write_audit_for_api.sql`) that `queueless_api` can
  call. `app/routes/admin.py::retrain_once` now calls that RPC instead of the raw `INSERT` that
  could never have worked; `scripts/dev_db.py`'s fixture gained a matching `private.write_audit`
  so this is tested against the real calling convention, not assumed. `app/analytics.py` and
  `app/summary.py` needed no code changes at all -- their calling convention was already the
  real one by construction. Genuinely nice to see the cross-session workflow (write real code
  against a documented, honest assumption; the other side reads the code as the spec) work
  exactly as intended here.
- 2026-09-26 (mobile): `.github/workflows/ios-sidestore.yml` was asked to publish
  `sidestore-source.json` with download URLs at `https://lpu.lol/ios/...` -- that path doesn't
  exist on the VPS edge (checked: no `/ios` block in `/opt/mcbots/edge/Caddyfile`, no
  `IOS_PUBLIC_BASE_URL`-style repo variable set). Rather than publish a source file pointing at
  a URL that 404s, the workflow defaults to the GitHub Release's own asset URLs (works
  immediately, no extra infrastructure) and reads an `IOS_PUBLIC_BASE_URL` repo variable when
  one is set, so switching to `lpu.lol/ios/` later needs only that variable plus a Caddy route
  serving `/srv/<wherever>/ios/*` (or proxying the GitHub Release) -- no workflow change.
- 2026-09-26 (apps/api, load test): two index recommendations from reading `call_next`'s and
  `issue_token`'s actual SQL (`supabase/migrations/0020`, `0010`), not just guessing at column
  names. Full live-stack load test not run this session (see `loadtest/README.md`'s "Status"
  section for why); this indexing analysis is real and independent of that -- verified with real
  `EXPLAIN (ANALYZE, BUFFERS)` against a Postgres fixture seeded with ~30k rows, not eyeballed.
  1. **`call_next`'s "find the next waiting token" subquery is unindexed and worth fixing.** Its
     `WHERE org_id = $1 AND service_id = ANY($2) AND service_day = $3 AND status = 'waiting'
     ORDER BY lane_rank, priority_at, number LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED` has no
     matching index today, so it's a full sequential scan on every single `call_next` call --
     the hottest RPC in the whole system, called on every counter click. Measured on a 30k-row
     fixture: **827 cost / 1.79ms / 470 buffer hits before, 17 cost / 0.04ms / 11 buffer hits
     after** adding:
     ```sql
     create index tokens_waiting_queue_idx
       on tokens (org_id, service_id, service_day, lane_rank, priority_at, number)
       where status = 'waiting';
     ```
     a ~44x execution-time drop and ~40x fewer buffer touches at this modest scale -- the gap
     only widens as real token volume grows past 30k rows, since the current path is a full
     table scan regardless of table size.
  2. **`issue_token`'s per-patient rate-check** (`WHERE patient_id = $1 AND created_at > now() -
     interval '10 minutes'`) is also an unindexed scan by the same reasoning, but wasn't
     separately benchmarked -- my synthetic fixture's seeded timestamps were all in the past
     relative to this session's real clock, which let the planner constant-fold the query to "no
     rows can match" before touching the table, making the before/after comparison meaningless
     rather than genuinely negative. Recommended by query shape alone (a straightforward "count
     recent rows for one patient" access pattern is a textbook `(patient_id, created_at)` btree),
     not by a benchmark:
     ```sql
     create index tokens_patient_created_idx on tokens (patient_id, created_at);
     ```
     Worth a real benchmark once a live stack with realistic recent data is available, rather
     than trusting this unverified.
- 2026-09-26 (mobile, patient): mandatory profile completion (name/phone/DOB/gender/city/address
  via `complete_my_profile`, department -> doctor cards, per-doctor booking, offline ticket claim
  with optional QR, "Book & pay", receipts in History) landed on `mobpatient`. Everything below
  is a boundary note for the other mobile engineer (auth/role routing, app.json/eas.json, iOS
  CI) rather than a change made on this branch, per this branch's ownership split.
  - **`(auth)/index.tsx`'s `routeAfterAuth`** still gates the profile-completion screen on
    `profiles.full_name` being null, not `profile_completed_at`. That still catches every fresh
    OTP signup (full_name is always null there), but a Google sign-in arrives with `full_name`
    already set from the provider and would skip straight to the tabs with the rest of the
    profile (phone/DOB/gender/city) still incomplete. Not fixed here — auth routing is out of
    this branch's scope. Not a live gap in practice: every take-token/book/claim entry point
    (`department/[serviceId].tsx`, `doctor/[doctorId].tsx`, `claim-ticket.tsx`) independently
    gates on `profile_completed_at` itself via `use-require-complete-profile.ts`, and the real
    enforcement is server-side in `complete_my_profile`'s callers regardless — this is only
    about which screen a Google sign-in lands on first.
  - **`app.json` has no camera permission entry.** `claim-ticket.tsx`'s QR scan (`expo-camera`,
    added to `apps/mobile/package.json` on this branch) is gated to `Platform.OS === 'android'`
    only, because iOS crashes on first camera use without `NSCameraUsageDescription` in
    `ios.infoPlist`, and `app.json` is out of this branch's scope. Manual code entry (the
    required path) works everywhere already. Add `NSCameraUsageDescription` (e.g. "Used to scan
    your paper ticket's QR code") to `app.json`'s `ios.infoPlist`, then drop the Android-only
    gate in `claim-ticket.tsx`.
  - **No DB support for "Book & pay"'s hold/payment state.** `token/[id].tsx`'s post-payment
    countdown banner is client-only cosmetic reassurance (no `token_status` value or column for
    a pending/held state anywhere through migration 0042) — it never blocks or changes the real
    queue position. Likewise "paid" in History's receipt line comes from a local
    `lib/paid-tokens.ts` record (per-device, not synced, gone on reinstall), since no
    `payments`/receipts table backs the patient side of this at all yet. Both are fine for a
    demo; a real implementation needs a `payments` table plus whatever `lpu.lol/pay/<tokenId>`'s
    own backend (a separate engineer's page, per the task prompt) actually writes.
- 2026-09-26 (apps/api, monitoring): `deploy/monitoring/`'s `postgres_exporter` needs a
  **read-only** Postgres role -- not `queueless_api` (least-privilege, shouldn't also carry
  monitoring's broader read access) and never `postgres`. Needed:
  ```sql
  create role ql_metrics with login password :'ql_metrics_password';
  grant pg_monitor to ql_metrics;  -- built-in Postgres role: stats views, no table data
  grant connect on database postgres to ql_metrics;
  ```
  `pg_monitor` (built into Postgres since 10) covers everything `postgres_exporter`'s default
  queries need (`pg_stat_activity`, `pg_stat_database`, replication state, etc.) without
  granting `SELECT` on any application table -- deliberately not asking for table-level access
  here, since dashboard/alerting needs come from Postgres's own stats views, not `tokens`/
  `profiles`/etc. content. `deploy/monitoring/docker-compose.yml`'s `POSTGRES_EXPORTER_DSN` env
  var takes this role's connection string once it exists; documented as a placeholder until
  then, not silently assumed.
- 2026-09-26 (apps/api, security hardening): recommended CSP for `lpu.lol` (`apps/web`), for the
  deploy session to apply at Caddy -- not this session's to implement (`apps/web` is out of
  scope). `pip-audit` on `apps/api` found nothing to react to here.
  ```
  Content-Security-Policy:
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    connect-src 'self' https://sb.lpu.lol https://api.lpu.lol;
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
    object-src 'none';
  ```
  Stated honestly, not oversold: `script-src 'self' 'unsafe-inline'` is a real weakening --
  Next.js's own hydration bootstrap is an inline `<script>` tag, so a strict `script-src 'self'`
  alone breaks the app on load unless Next is configured to emit a per-request nonce and every
  inline script carries it (a real, larger change to `apps/web`'s own request pipeline, not a
  Caddy-only header). `'unsafe-inline'` is the pragmatic default most Next.js deployments ship
  with; nonce-based tightening is the real upgrade path if this matters more than the setup cost,
  not something to silently promise here. `connect-src` is scoped to the two real backend hosts
  this app actually talks to (`sb.lpu.lol`, `api.lpu.lol`) -- update it if `apps/web` starts
  calling anything else. `frame-ancestors 'none'`/`object-src 'none'`/`base-uri 'self'`/
  `form-action 'self'` have no such tradeoff and are safe to apply as-is.
- 2026-09-25 (payments): `apps/mobile/src/lib/paid-tokens.ts` (local-storage-only "did I pay"
  tracker, its own header comment says it exists only because no `payments` table existed yet
  "checked through 0042") is now superseded -- `supabase/migrations/0050-0052` landed a real
  `payments` table plus the whole `start_paid_booking`/`record_order`/`confirm_payment` flow, and
  `docs/PAYMENTS.md` documents the exact mobile integration contract (open
  `apps/web`'s `/pay/[tokenId]` in an in-app browser, patient's access token in the URL
  fragment -- never a query string, returns via `queueless://paid/<tokenId>`). No mobile screen
  actually calls `markTokenPaid`/`getPaidAt` yet (checked `doctor/[doctorId].tsx` and every other
  `apps/mobile` screen -- no match), so nothing live breaks by leaving the stub in place, but
  whoever wires up mobile's own "Book & pay" trigger next should read `docs/PAYMENTS.md` first
  rather than building against the local-only stub.
- 2026-09-25 (payments, self-review flag -- not fixed here, out of `apps/pay`'s owned dirs):
  `token_status` gained `pending_payment` (`0050_payments_enum.sql`). Four existing files declare
  their own hand-written `TokenStatus` TypeScript union that does **not** include it:
  `apps/web/src/app/admin/_lib/types.ts`, `apps/web/src/app/counter/types.ts`,
  `apps/web/src/app/t/[id]/data.ts`, `apps/mobile/src/app/(app)/token/[id].tsx`. This doesn't
  break type-checking (TS trusts the declared union, it can't see real DB rows), but
  `apps/web/src/app/t/[id]/status-view.tsx`'s `STATUS_LABEL`/`STATUS_BADGE_CLASS` are
  `Record<TokenStatus, ...>` lookups keyed off that type -- a real `pending_payment` row landing
  on `/t/[id]` (a bookmarked/old link before the patient finishes paying, say) would look up
  `undefined` there today: a blank status body with a literal "undefined" badge, not a crash.
  Low probability (the normal flow only reaches `/t/[id]` after payment, via `/pay/[tokenId]`) but
  real. Whoever owns those files should add a `pending_payment` case (or exclude it upstream)
  before it's hit for real; `counter/types.ts`'s own use (`ACTIVE_TOKEN_STATUSES`, a plain array,
  not a full lookup) looked lower-risk on a quick check but wasn't traced further.
- 2026-09-26 (mobile, staff/admin pass): **returning users get no email code.** GoTrue only sets
  a code subject for the *confirmation* template (`GOTRUE_MAILER_SUBJECTS_CONFIRMATION` in
  `supabase/docker-compose.yml`). A user who already exists gets the *magic link* template
  instead: subject "Your sign-in link", a link, no 6-digit code, so the app's code screen can never
  complete for them. Confirmed with a real inbox on 2026-09-26. Fix is server-side (not mobile's
  dirs): add `GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "{{ .Token }} is your WaitWise code"` and
  redeploy auth. No app change needed; `verifyOtp({ type: 'email' })` accepts that code.
- 2026-09-26 (mobile): staff/admin skip the patient profile form after email-code or Google
  sign-in. The form asks for phone/DOB/city for booking, and prod staff accounts have no name.
- 2026-09-26 (mobile): creating a staff *account* stays web-only. `apps/web`'s
  `/api/admin/staff` needs the service-role key and authenticates by Next cookie session, so the
  phone can't call it. Mobile covers the rest: list members, promote an existing user, change a
  role, demote to patient.
- 2026-09-26 (mobile): live staff/admin screens poll every 15 s plus refetch on focus
  (`use-live-refresh.ts`). Switch to the DB broadcast topics once `docs/API_CONTRACT.md` lists
  them; none are documented yet.
- 2026-09-26 (mobile, patient pass): `POST https://api.lpu.lol/predict` has no CORS headers, so
  every call from `expo start --web` (this app's own dev/test target, `localhost:8830`) fails
  preflight and falls back to the local estimate -- confirmed live against prod, not a guess.
  Native iOS/Android builds aren't affected (browser CORS doesn't apply there), so this doesn't
  block real users, but it does mean the "predicted" (vs "estimate") wait label can't be verified
  from a web build. Fix is `apps/api`'s (add `Access-Control-Allow-Origin`), not mobile's dir.
- 2026-09-26 (mobile, patient pass): reused `use-live-refresh.ts`'s existing pattern for the
  token and My-active-tokens screens (10 s here, not the shared 15 s default -- a queue position
  is the one number a patient actually watches) rather than writing a second poll/focus
  mechanism, per the task's own "add refetch on focus and a 10s poll" ask.
- 2026-09-26 (mobile): unified sign-in replaces the code-first screen and the separate
  password-fallback screen. Emails carry `emailRedirectTo`/`redirectTo` =
  `queueless://auth/callback` (allow-listed), handled by `src/app/auth/callback.tsx`, which lives
  outside `(auth)` so that group's "signed in -> tabs" redirect can't interrupt a password
  reset. Verified on prod: the reset email's link redirects to
  `queueless://auth/callback?code=…` and the exchange returns a session with
  `redirectType: 'recovery'`.
- 2026-09-26 (ci): `ios-sidestore.yml` drops `concurrency:` (it keeps one pending run and
  cancels the rest). A `wait-turn` job on ubuntu waits for older runs, then skips the macOS build
  if a newer run is already queued. Needs `actions: read`.
- 2026-09-25 (payments, found not fixed -- unrelated to `apps/pay`'s owned files):
  `supabase/tests/040_issue_token.test.sql` fails on current `origin/main`, independent of any
  payments change (reproduced standalone, `docker exec ... psql < tests/040_issue_token.test.sql`,
  no payments migration applied at all needed to trigger it). Its own rate-limit fixture (around
  line 71) does a raw `insert into public.tokens (...)` while impersonating role `authenticated`
  via `set local role authenticated` -- `authenticated` has never had an INSERT grant on
  `public.tokens` in the current schema (RPC-only writes throughout, confirmed via
  `information_schema.role_table_grants`), so this now fails with `permission denied for table
  tokens`. Whoever owns `issue_token`'s test (`git log` on the file: last real edit was the
  original `issue_token`/doctors-era commits) should either run that fixture insert as `postgres`
  (matching every other file's raw-fixture convention, e.g. `080_housekeeping.test.sql`) or grant
  a narrower path -- not fixed here, out of scope for this branch, but it blocks `test.sh`'s
  fail-fast loop from ever reaching later files (alphabetical order), so anyone running the full
  suite locally should know a green run right now requires skipping or fixing this file first.
- 2026-09-26 (mobile auth, review round): `experimental.appendPkceFlowIdToRedirects` is on, so
  every emailed link carries `sb_flow_id` and finds its own PKCE verifier (verified on prod:
  reset link -> `queueless://auth/callback?code=…&sb_flow_id=…` -> recovery session). Without it
  any later sign-in attempt overwrote the one shared verifier and broke earlier links. Sign-up
  now sets the typed password after the code is verified: GoTrue keeps the old (random) password
  when the address already existed unconfirmed. "Send reset link" has the same 65 s cooldown as
  the code screens.
- 2026-09-26 (ci): each waiting iOS run holds one idle ubuntu runner while it polls (60 s). Only
  this workflow uses Actions today, so nothing else is starved; runs created before the skip
  logic (up to #45) still build one by one, later ones skip themselves when superseded.
- 2026-09-27 (apps/api, ML recalibration): synthetic per-patient service time recalibrated to
  published Indian OPD studies, per-org request (Yash) to ground the demo model in real numbers.
  Sources: General OPD 6.925±7.688 min
  (https://www.ijcmph.com/index.php/ijcmph/article/view/11281, Maharashtra tertiary hospital);
  Pharmacy 81.5±51.2 s
  (https://www.academia.edu/43251675/Prescription_pattern_at_outpatient_department_in_a_tertiary_care_hospital_at_central_Maharashtra_India,
  central Maharashtra tertiary hospital); Pediatrics/Orthopedics have no Indian department-
  specific service-time study found -- ASSUMPTION, reuse General OPD's number, documented as
  such in `docs/api/model-card.md`, not silently presented as measured; Kolkata waiting-time
  context (pediatric OPD shortest real wait, 43 vs 122 min) from
  https://www.ijcmph.com/index.php/ijcmph/article/view/5276; international consultation-time
  context (India ~2 min primary care) from
  https://research.edgehill.ac.uk/ws/portalfiles/portal/29790731/International_variations_in_primary_care_physician_consultation_time.pdf;
  Kolkata tertiary OPD waiting-time methodology from
  https://www.ovid.com/jnls/ijcm/fulltext/10.4103/ijcm.ijcm_abstract210~ijcm210a-assessment-of-outdoor-patients-waiting-time-and.
  Real SD/mean for General OPD is >1 (individual patients vary *more* than the average) --
  this alone made the deterministic-base v1/v2 generator's 82%-improvement figure look
  unrealistic in hindsight, and a genuine bug surfaced once real variance was calibrated in:
  `HistGradientBoostingRegressor`'s default squared-error loss scored the model *worse* than
  the fair baseline (-13.09%) against the new noisy, right-skewed target -- traced to per-leaf
  sample means being noisier than the baseline's single pooled per-service mean, not
  overfitting (more regularization made it worse, not better). Fixed in
  `scripts/train_core.py` by fitting on `log1p(wait_minutes)` and predicting via `expm1(...)`
  -- the textbook-correct transform for a lognormal target, not a tuning trick, plus
  `min_samples_leaf=100` as a small additional empirical tune. Net result, honestly reported:
  MAE 28.33 vs fair baseline 29.47, a real 3.90% improvement -- much smaller than the old
  81.98%, which is the correct outcome once the target has real, cited, dominant per-patient
  randomness. New sanity-rule test (`tests/test_predict.py`) asserts the model's own
  prediction for 1 person ahead / 1 counter lands within ±30% of the department's real cited
  mean (measured: 5.26 min vs 6.925 for General OPD, 1.51 min vs 1.358 for Pharmacy). `app/
  ml_runtime.py::predict_with_fallback` now checks `meta["target_transform"] == "log1p"`
  before applying `expm1` to a raw prediction -- an older artifact without that field is
  treated as the identity transform, not a crash. Retrained locally (`scripts/train.py`) and
  verified inside a real Docker build+run, not just pytest; not retrained via the live
  `POST /admin/retrain` path, since that trains on real completed prod tokens (a different,
  unrelated dataset) -- there is currently no real production history large enough to make
  that retrain meaningful, and this recalibration is about the synthetic generator specifically.
- 2026-09-26 (payments): full Zomato-style checkout for both walk-in tokens and paid appointments
  (migrations 0055-0058) -- `start_paid_appointment` mirrors `start_paid_booking` for a slot hold,
  `record_order`/`confirm_payment`/`record_refund` all branch on token vs appointment,
  `doctor_leave_refund_candidates`/`housekeeping` cover both. `my_payment_status` (0058) is a
  narrow SECURITY DEFINER owner-read door onto the otherwise admin-only `payments` table (status/
  refunded_at/refund_reason only, ownership-checked) so patient-facing screens can show Paid/
  Refunded without a real RLS policy on `payments` itself. `/pay/[tokenId]` renamed to
  `/pay/[holdId]` and rebuilt as a proper billing review screen (doctor card, patient
  details+Edit, price breakdown, hold countdown, cancellation policy, sticky Proceed bar), same
  on mobile's new `checkout/[holdId].tsx`. Two real bugs found and fixed via live verification
  against a real RPC-minted local hold, not just reasoning: `appointments_state_machine` (0014)
  never allowed `pending_payment -> booked`/`cancelled` (fixed in 0057, was tested for tokens'
  equivalent transition, missed on the appointment side); `start_paid_appointment`'s doctor-leave
  check compared against `service_day(now())` ("today") instead of the slot's own date, so a
  same-day leave for an unrelated doctor wrongly blocked every later booking that day regardless
  of which date the appointment was actually for.
  **Not verified live on prod this pass**: email OTP sign-in on `lpu.lol` is currently blocked
  (every send attempt across 3 fresh addresses failed with "Couldn't send the code", consistent
  with QA-2026-09-26-0332.md's independent same-day finding) -- couldn't complete a real
  Razorpay-test-card click-through. DB (47 pgTAP), API (161 pytest), and the checkout UI itself
  (live against real local data, real hold, real login) are all verified; only the final prod
  click-through is outstanding, blocked on mail delivery, not on this code.
