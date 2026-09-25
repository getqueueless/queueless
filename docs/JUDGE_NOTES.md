# Judge notes

Plain-English notes per feature: what was built, how it actually works, and why.

## Mobile

- **Auth.** Email + password against Supabase Auth (`signUp`/`signInWithPassword`), autoconfirmed
  server-side so sign-up drops straight into a session — no phone OTP, no guest flow, every
  screen past sign-in requires a real session. Root routing is split into `(auth)`/`(app)` route
  groups, each gated by its own `onAuthStateChange`-driven redirect, so the app can never show an
  authenticated screen without a session or vice versa.
- **Home.** Lists open services (`services where is_open = true`) with a live waiting count from
  `board_services`, kept current over Supabase Realtime (`postgres_changes` on `board_services`,
  no polling) and refetched on every reconnect since Realtime never replays missed events. Each
  card best-effort calls the optional `/predict` API (1.5s timeout) for a smarter wait estimate,
  labeled "predicted"; if that's slow, down, or not built yet, it falls back to a local
  `waiting_count × avg_service_secs ÷ open_counters` estimate, labeled "estimate" — the queue
  data itself is always real, the ML number is a pure enhancement, never a blocker.
- **Take token.** Two taps: pick a service, confirm on a sheet. Calls the real `issue_token` RPC.
  The RPC is idempotent by design — a double-tap or retry returns an `already_active` error with
  the existing ticket attached rather than a fresh one, and the app treats that identically to a
  success (navigates to the same ticket) instead of showing an error.
- **Token detail — live position.** The token code renders large and high-contrast; this is also
  what staff scan or type to verify a priority status, so legibility is a correctness requirement,
  not styling. Position/ETA/status come from the `my_queue_status` RPC, kept live by subscribing
  to Realtime changes on the caller's own `tokens` row (RLS-restricted) and on that service's
  `board_services` row (covers other patients' tickets advancing your position without touching
  your own row), refetching on reconnect and on app foreground. A cancel button appears while
  waiting and calls `cancel_token`.
- **Priority.** No self-report control exists anywhere in the app — deliberately. Only staff can
  mark someone senior/pregnant, via a staff-only RPC (`verify_priority`) by scanning/typing the
  code on the token screen. The token screen's priority card is a static explainer with zero
  props and zero writable state, so there's no abuse vector a patient could exploit.
- **Appointments.** Browse open services, pick an upcoming 15-minute slot, book/cancel via the
  `book_appointment`/`cancel_appointment` RPCs. "Check in" only appears once the slot is inside
  its window (30 min before to 15 min after `starts_at`) and calls `check_in`, which mints a real
  token and hands off to the same live token-detail screen as a walk-in. Any RPC error triggers a
  full refetch of the slot list so a stale "Book" button on a slot that just filled never lingers.
- **History.** Past tokens and appointments (done/no-show/cancelled/skipped), newest first — a
  plain RLS-scoped `select`, no manual user-id filtering needed since the backend already scopes
  every row to the caller.
- **Settings.** Language row (English active, Hindi shown but disabled — no i18n system for one
  placeholder string) and sign-out, which defers to the app's existing session-watcher redirect
  instead of navigating manually.
- **Notifications — reliable path first.** Expo Go cannot receive remote push on Android since
  SDK 53, so the app doesn't treat push as the primary mechanism. The real path is a Supabase
  Realtime subscription on the signed-in patient's own `notifications` rows — the instant a
  `called`/`almost_turn` row lands, it shows an in-app banner and fires a local notification
  (works even backgrounded), with zero push setup required. Remote Expo push registration is
  layered on top as a best-effort enhancement: `getExpoPushTokenAsync()` is wrapped so the known
  Expo-Go/Android gap degrades to "no token" instead of crashing, and registering the token with
  the API is fire-and-forget, never blocking.
- **Offline.** A slim banner (`@react-native-community/netinfo`) appears when connectivity drops
  and disappears on reconnect.

## Database

- **Schema.** Every table lives in self-hosted Postgres behind PostgREST — `organizations`,
  `profiles`, `services`, `counters`, `counter_services`, `tokens`, `appointment_slots`,
  `appointments`, `board_services`, `board_counters`, `notifications`, and an append-only
  `audit_log`. A patient's role, org and priority status are never taken from their own signup
  metadata — a database trigger on `auth.users` copies only their name and hard-codes
  `role='patient'`, closing an attack where a client could `signUp({data:{role:'admin'}})` and
  grant themselves access. `audit_log` can't be edited or deleted by anyone, including the
  database owner — enforced by a trigger, not just a permission grant, because permission grants
  don't bind table owners.
- **API isolation.** `apps/api` connects to Postgres as its own `queueless_api` role, never as
  the database owner. That role can only read `tokens`/`board_services` (for wait predictions),
  read and prune `push_tokens` (to send/clean up push notifications), and record which pushes it
  already sent in `private.token_notifications` — it cannot write `tokens`, `profiles`, or
  anything the RPC layer owns. Registering a push token is still the client's own job through
  normal RLS (`push_tokens` is owner-only for `authenticated`), not the API's.

## Web app

- **Stack.** Next.js 16 (App Router, TypeScript) under `apps/web`, styled with plain CSS Modules
  against tokens from `apps/web/DESIGN.md` (calm neutral canvas + one teal accent, both themes
  native from day one — this runs on a projector during the live demo). `types/database.types.ts`
  is a hand-written placeholder for the Postgres schema; it predates the real migrations and still
  needs a real `supabase gen types` pass once there's a DB connection to run it against — noted
  rather than silently left wrong.
- **Auth.** `/login` is the only entry point — email/password via
  `supabase.auth.signInWithPassword()`, no sign-up route anywhere in the app. That matches the DB
  side: the `on_auth_user_created` trigger always inserts new profiles as `role='patient'`, so a
  staff or admin account can only ever come from an admin changing that row directly, never from
  self-service signup. The form is a client component driven by `useActionState` calling a
  server action; input is validated with `zod` (`lib/validation/auth.ts`) before it ever reaches
  Supabase. Accessibility: every field has a real `<label htmlFor>`, invalid fields get
  `aria-invalid` + `aria-describedby` pointing at their error text, and focus moves to a
  `role="alert"` error summary on a failed submit so keyboard/screen-reader users don't have to
  hunt for what changed.
- **Session gating.** `proxy.ts` (Next 16's renamed `middleware.ts`) is a thin wrapper around
  `lib/supabase/proxy.ts`, which refreshes the session cookie on every request and decides access:
  `/login`, `/display/[service]`, `/t/[id]` and `/kiosk` are public; everything else redirects to
  `/login?next=<path>` without a session; `/admin/**` additionally requires
  `profiles.role = 'admin'` (looked up by `id = auth.uid()`, the real column — the schema has no
  separate `staff` table) and sends non-admins to `/counter` instead. No RLS policy letting a user
  read their own `profiles` row has landed yet, so that lookup fails closed: any error or missing
  row denies admin access rather than granting it, and the dependency is named in a code comment
  rather than silently assumed away.
- **Env vars.** `.env.example` lists the 4 required vars as placeholders — the two public Supabase
  values, the server-only service-role key (never `NEXT_PUBLIC_`), and `NEXT_PUBLIC_API_BASE_URL`
  for the FastAPI service's `/predict` and `/metrics`. Real values live in untracked `.env.local`.
- **Counter (`/counter`).** The staff screen for calling patients forward. Shows a big "Call Next"
  button when the desk is idle, or the current ticket (code, lane, a live timer since it was
  called) with Done / No-show / Recall / Transfer actions — each one a single Postgres RPC call
  (`call_next`, `mark_done`, `mark_no_show`, `recall_token`, `transfer_token`), never re-implemented
  client-side. Keyboard shortcuts (N/D/S/R) are wired and shown on-screen. A second screen open on
  the same counter updates live over Supabase Realtime, no refresh needed. Gated to staff/admin
  accounts.
- **Display board (`/display/[service]`).** The public TV screen for a waiting room — no login. It
  reads only `board_services`/`board_counters`, the two tables open to anonymous visitors today, and
  updates live. It announces a called number out loud (tap-to-enable sound, then a short chime
  followed by speech), and shows a "next up" number as a clearly-labeled estimate rather than
  claiming certainty, since it can't read the raw ticket list.
- **Admin dashboard (`/admin`).** A live view of queue length, average wait, tokens/hour and no-show
  rate, next to a chart comparing the ML service's predicted wait against what actually happened.
  Also where staff manage services, counters, and priority-lane settings, and where an admin creates
  new staff logins — that last part runs on the server with the elevated Supabase key, never in the
  browser, and re-checks the caller is really an admin before doing anything.
- **Kiosk (`/kiosk`).** The front-desk screen for walk-ins with no phone or app. Staff type the
  visitor's name, the system issues a ticket, and prints a slip with a QR code linking to that
  ticket's own status page — sized for either a receipt printer or a regular sheet of paper.
- **Status page (`/t/[id]`).** The page a patient's QR code opens — no login. Shows their ticket's
  live status, how many people are ahead of them, and an estimated wait, updating on its own so
  there's nothing to refresh.
- **Shared gap.** The counter screen's RPCs (`call_next`, `mark_done`, `mark_no_show`,
  `recall_token`, `transfer_token`) aren't in `supabase/migrations` yet, and no RLS policy lets a
  signed-in user read their own `profiles` row yet either — the counter and admin screens fail
  closed with a plain "server updating, retry shortly" message rather than crashing, and will start
  working end-to-end the moment the database side ships those. (The kiosk's own RPC,
  `staff_issue_token`, has since landed.) Separately, `next build` fails repo-wide
  right now on a pre-existing `@queueless/db` package issue (its `errors.js` export doesn't resolve
  under Turbopack, even though typechecking passes clean) — outside this app's scope to fix, flagged
  for that package's owner.
- **Design + accessibility pass.** Reviewed all six routes for contrast, keyboard/screen-reader
  support, and responsive behavior from kiosk-laptop width up to a TV. Real fixes: three light-mode
  colors (a muted gray, the success/warning badge text) fell short of WCAG AA 4.5:1 against their
  own backgrounds and were darkened just enough to clear it; the admin sidebar's tablet-width
  "collapse to icons" state (documented in DESIGN.md, never actually built) was leaving six blank,
  unlabeled links, now labeled at every width; the three admin data tables had an unlabeled actions
  column and un-scoped headers; five async forms/dashboards updated a status banner with no
  `role="alert"`/`role="status"`, so screen readers never heard the result of a save or a delete;
  added a skip-to-content link ahead of the sidebar; turned on Recharts' built-in
  `accessibilityLayer` for the wait-time chart. Also ran `impeccable detect` against the design
  system and closed 5 of 12 findings (2 real off-ramp font sizes snapped to the nearest step, 3
  legitimate large-format sizes documented as named type steps instead of changed); the remaining 6
  are `/display/[service]`'s intentional `clamp()` fluid type for the kiosk-to-TV size range, noted
  in DESIGN.md rather than "fixed." `/impeccable init` needs an interactive PRODUCT.md interview and
  couldn't run in this pass; `critique`/`polish` ran in a degraded, single-context form (no
  sub-agent isolation, no live browser injection) since neither was available here, per the skill's
  own documented fallback.

## Backend

- **What it is.** `apps/api` is a separate Python FastAPI service that runs beside Supabase, not
  inside it — it handles the three things a database and a static frontend can't do well on their
  own: verifying who's calling, pushing notifications to a phone that isn't open, and running a
  background job safely across multiple copies of the service. Endpoints: `GET /health` (is the
  process alive), `GET /ready` (can it reach Postgres — what a load balancer should watch), `POST
  /push-tokens` (register a phone for push, requires login), `POST /predict` (wait-time estimate,
  public), `GET /metrics` (Prometheus stats for monitoring).
- **Who you are, checked twice.** A Supabase login token proves *identity* (which user), never
  *permission* (what they're allowed to do) — the token's own claims are editable by the client
  SDK and can't be trusted for that. So `apps/api` decodes the token once to get the user's id,
  then looks up their real role from the `profiles` table on every privileged request (cached 5
  seconds so it isn't a database round trip every time — meaning a revoked staff account is locked
  out within 5 seconds, not instantly). Nothing a client sends in a request body or header is ever
  treated as a role.
- **Push notifications.** Two moments matter to a waiting patient: "you're 3rd in line" and "you've
  been called." The database side of this system doesn't yet have the trigger that would notify
  `apps/api` the instant either happens (that's a small piece of SQL the database team still needs
  to add), so today `apps/api` checks for both conditions itself every 5 seconds and sends the
  push — a documented, working, degraded mode rather than a feature that's silently broken. The
  moment that trigger lands, the faster instant-notify path activates automatically alongside it,
  with no risk of double-notifying (each notification is recorded once, so a repeat check is a
  no-op).
- **No-show handling.** If a patient is called and doesn't show up within a set window (15 minutes
  by default), a background job automatically marks their ticket as a no-show so the desk can move
  on. If this service is ever run as multiple copies for scale, a database-level lock guarantees
  only one copy actually does the work on any given tick — proven with an automated test that runs
  two copies at once and checks exactly one of them wins.
- **Known gap, stated plainly.** `/predict` currently takes one of the 5 fixed Hospital-OPD service
  names (general_opd, pediatrics, ortho, dental, eye) directly, matching how the ML model was
  trained. The real `services` table uses a generated id per service instead of these names, so
  wiring the web/mobile screens up to call `/predict` for real needs one small lookup (id → name)
  on whichever side calls it — not built yet, called out here instead of hidden.

## AI/ML

- **What it predicts.** How many minutes a patient will likely wait, given their service, the hour
  and day, how many people are ahead of them, and how many counters are open.
- **The model.** A gradient-boosted regression model (`HistGradientBoostingRegressor`), trained
  once offline and loaded at startup — never retrained live, never trained on a live request.
- **The data is synthetic, and that's stated up front.** No real patient data exists yet, so 20,000
  rows were generated from a documented formula (base wait time per service, slower at peak hours
  and on Mondays, divided by counters open, plus realistic random noise) — every assumption behind
  that formula is written out in `docs/api/model-card.md`.
- **The actual, measured numbers** (from running `scripts/train.py`, not hand-typed): the model's
  average error is **3.84 minutes**; a naive guess (people-ahead × average service time, ignoring
  everything else) is off by **49.88 minutes** on average — a **92.3% improvement**. The
  naive-guess comparison matters because it's the honest bar the model has to clear, not a
  strawman.
- **The responsible-AI part.** If the model is asked about a situation it barely saw in training
  (fewer than 30 similar examples), it does not guess — it falls back to that same honest naive
  estimate and says so in the response (`"fallback": true`). This is the guardrail against a
  confident-sounding wrong number for a case the model doesn't actually know.
- **What this is not.** Not clinical triage, not a staffing tool, not validated against any real
  hospital. It's a "here's roughly how long" number shown to a patient, nothing more, and it says
  so in its own documentation.

## Security

- **The live red-team question judges will test:** can a client claim a role it doesn't have, or
  break in with a forged/expired/tampered login token? No. The token's signature, expiry, and
  audience are checked with a fixed algorithm the client can never influence (never trusts a
  token's own claim about how it was signed — the classic `"alg": "none"` bypass), and every
  permission decision is re-checked against the database's own record of who that user actually
  is, never against anything the client sent.
- **Every input is validated at the door.** Every request shape is locked down — wrong types,
  missing fields, or extra fields the client had no business sending are all rejected before any
  of that data reaches application logic or the database. Nothing is ever assembled into a SQL
  query from raw text.
- **Abuse limits.** Login-checking endpoints are rate-limited tighter than public ones; health
  checks used by infrastructure are never rate-limited (they're not user traffic). Cross-site
  requests are only ever allowed from an explicit, named list of web addresses — never "allow
  anyone," which is a real, common hole this system deliberately avoids.
- **If something breaks, it fails safely.** An unexpected server error never shows a stack trace
  or internal detail to the caller — just a generic message and a request id support can trace.
- **Two limits stated honestly rather than hidden:** the rate limiter counts per running copy of
  the service, so running several copies at once raises the effective ceiling proportionally (fine
  for a single-instance hackathon demo, a named upgrade path exists for real scale); and the
  no-show job's safety lock assumes one database, not a sharded cluster (also fine at this scale).
  Full write-up in `docs/api/threat-model.md`.
