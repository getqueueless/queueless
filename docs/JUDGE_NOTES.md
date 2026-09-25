# Judge notes

Plain-English notes per feature: what was built, how it actually works, and why.

## Mobile

- **Auth.** Patients sign in with a 6-digit code emailed to them (`signInWithOtp` /
  `verifyOtp`), not a password — nothing to forget at a hospital kiosk, and no phone number
  required either, matching this system's own no-SMS decision. `shouldCreateUser: true` means
  sign-up and sign-in are the same action; there's no separate account-creation screen. First
  login (before a display name exists) drops into a one-field name screen, then the app. Root
  routing is split into `(auth)`/`(app)` route groups, each gated by its own
  `onAuthStateChange`-driven redirect, so the app can never show an authenticated screen without
  a session or vice versa. Checked end to end against production on 2026-09-26 for a first
  sign-in: a real code arrived by email, the app exchanged it for a session, and the name screen
  saved the patient's name to their profile. A password sign-in screen is still reachable as a
  labeled fallback. The error codes (`otp_expired`, `over_email_send_rate_limit`) were checked
  against the running GoTrue instance, not just its docs.
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
- **History.** Past tokens and appointments (done/no-show/cancelled/skipped), newest first. Each
  query filters on the signed-in patient's own id instead of trusting row-level security alone,
  so a missing policy can never show one patient another patient's history. Appointments uses
  the same filter to find "my" bookings.
- **Settings.** Language row (English active, Hindi shown but disabled — no i18n system for one
  placeholder string), a System/Light/Dark appearance control, and sign-out, which defers to the
  app's existing session-watcher redirect instead of navigating manually.
- **Visual redesign (MedWin).** Every screen restyled to a design system derived directly from a
  licensed HTML template (`~/code/design-ref/medwin/` — Poppins font under the SIL Open Font
  License, colors/type scale hand-extracted and cited by CSS line in `apps/mobile/DESIGN.md`,
  never copied assets or markup). Pure visual pass — every RPC call, Realtime subscription, and
  screen's data logic is byte-identical to before; only JSX structure and `StyleSheet` values
  changed. Also added: a persisted light/system/dark theme preference (stored in the same
  `localStorage` polyfill the Supabase client already uses, no new dependency), and fixed several
  pre-existing spots where the brand cyan was used as small body/caption text — it measures
  ~2.4:1 contrast on white, under WCAG AA's 4.5:1 minimum, so it's fill/button/large-decorative
  only now, never text at that size. The brand guide's contrast rules are tokens now too. Cyan
  heading words use a darker display cyan (`#0a95ae`, 3.55:1, large text only), and text on
  cyan buttons is ink (6.39:1) instead of white (2.40:1).
- **Notifications — reliable path first.** Expo Go cannot receive remote push on Android since
  SDK 53, so the app doesn't treat push as the primary mechanism. The real path is a Supabase
  Realtime subscription on the signed-in patient's own `notifications` rows — the instant a
  `called`/`almost_turn` row lands, it shows an in-app banner and fires a local notification
  (works even backgrounded), with zero push setup required.
- **Push token registration.** Remote Expo push sits on top of that as a best-effort extra.
  - **Where tokens go.** The app writes its own push token straight into the `push_tokens` table
    through the Supabase client, with no API in between. Row-level security lets a patient touch
    only their own rows. That means one network hop fewer and one service fewer that can be down,
    and it is the same pattern the app already uses to read `notifications`. The API only reads
    these rows to deliver pushes, and it deletes a token once Expo reports it dead.
  - **Keeping the row right.** A token is unique, so re-saving it after a restart is a no-op
    rather than an error. When the phone's OS swaps the token, the app saves the new one.
  - **Sign-out.** Sign-out deletes this phone's token and no other, so the patient's other phones
    keep receiving. It runs before the session ends, because the security rule needs a live
    session to allow the delete.
  - **Failure is harmless.** No token, a denied permission or a failed save never blocks the app.
  - **Tested.** The database side was checked against production using the app's own code and
    two real accounts: save, save again, a second account blocked from taking over the token,
    then delete.
  - **Where it works.** Expo only issues tokens to a build linked to an EAS project, and Expo Go
    on Android has no remote push at all. So this path runs in the installed app, not in Expo Go.
- **Offline.** A slim banner (`@react-native-community/netinfo`) appears when connectivity drops
  and disappears on reconnect.
- **App icon and splash.** The launcher icon, the Android adaptive icon (with a monochrome layer
  for themed icons) and the splash screen all use the Queueless mark on the brand's slate-teal.
  They are rasterized from the same SVGs as the web app's icon, so phone and web share one
  identity.
- **Production.** The app runs against the deployed backend (`sb.lpu.lol`, `api.lpu.lol`). A web
  build of the same code also runs in a browser for quick checks.

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
  the database owner. It can read only what it uses — the caller's role and org (never names or
  phone numbers), queue state for wait predictions and metrics, a patient's push-device tokens and
  undelivered notifications — and write only two things: marking a notification delivered and
  deleting a dead device token. A test proves that exact list, including that each read returns
  real rows. Registering a push token is still the client's own job through normal RLS
  (`push_tokens` is owner-only for `authenticated`), not the API's.
- **Why "real rows" matters.** Turning on Row Level Security hides every row from a role that no
  policy names, even when the role holds a grant — no error, just nothing. That is exactly what
  happened: the API's reads of the queue boards came back empty and its dead-device cleanup
  deleted nothing, while the permission table looked correct. Each now has an explicit policy,
  and the test counts rows instead of checking grants.
- **Push delivery without a spam hole.** Once the API pushes every notification row to a phone,
  whoever can write that table can push any text to any patient. Apps can no longer create
  notifications or reset the "already pushed" marker — only the database's own logic creates
  them, and the app can still mark one read. Notifications that existed before delivery was
  switched on were marked delivered during the upgrade, so no phone gets a burst of stale alerts.
- **Why email OTP.** Patients sign in with a 6-digit code emailed to them, not a password with
  autoconfirmed signup. One verified inbox per patient closes the "make 50 accounts to spam the
  queue" hole that autoconfirm-only signup left wide open — getting a token now costs a real
  email address, not just a form submission. A global send-rate cap (30 codes/hour) limits how
  many codes this abuse path can ever generate, on top of the existing per-patient limits
  (3 tokens/10min, cooldown after cancellations). Staff/admin logins are untouched — they still
  use a password and never go through the mailer.

## Database security

- **"Ask your data" without a text-to-SQL hole.** An admin can ask questions about their queue
  (no-shows by service, wait times by hour, busiest desks, priority-lane mix) through 8 fixed,
  read-only Postgres functions the backend's DeepSeek tool-calling can call — never a generated
  SQL string. Whatever asks the question, the only questions it can ever ask are these 8 shapes;
  there is no path from a typed question to an arbitrary query. Every one of them checks the
  organization it's given against the caller's own signed session before running anything — an
  admin cannot pass another org's id and see its data. This is proven with two organizations in
  the test suite, not just asserted: org A's admin gets `forbidden` for org B's id, and the
  reverse — and separately proven by running the backend's own real code (not a mock) against
  this exact database and getting real rows back.
- **AI-generated ops summaries are read-only for admins, write-only for the API.** The daily
  summary lives in its own table, one row per organization/day. The backend that generates it
  can write and read; nothing else, including a signed-in admin, can write to it at all — a
  same-day regeneration replaces that one row through the backend's own controlled path, never
  through a client request.
- **The API's audit door stays narrow even as its job grows.** Logging apps/api's own actions
  (a push delivered, a summary generated) into the same audit trail the RPCs use does **not**
  mean giving it `INSERT` on `audit_log` — that would let anything running as that role write
  arbitrary rows into the one table this whole system treats as ground truth. Instead it calls
  one function that only ever inserts, with the actor left null (it isn't a signed-in user), and
  it still can't read `audit_log` back — proven the same way as everything else in this section,
  by testing that the door opens and every other one stays shut.
- **A real bug this pass caught, not just a design point:** the fixed-date functions above (and
  the existing admin dashboard) take a calendar day, and this system's "day" is always the
  organization's local one (`Asia/Kolkata`), never the database server's own UTC clock. For
  about 5.5 hours every day (00:00–05:30 IST) a naive `current_date` on the server and the real
  local day are different dates. It surfaced live while testing `busiest_counters`: called with
  the server's raw date it returned nothing for a desk that had, in fact, served someone that
  IST day. Every date-taking analytics function is documented with this trap explicitly named in
  `supabase/README.md`, not left for the next person to rediscover the same way.
- **What this pass found but did not fix, stated plainly rather than left implicit:** row-level
  security now covers `organizations`, `services`, `counters`, `board_services`,
  `board_counters`, `push_tokens`, `notifications` and, as of this pass, `ops_summaries`. It is
  **still off** on `profiles`, `tokens`, `appointments`, `appointment_slots` and `audit_log` — and
  on those tables, `anon` and `authenticated` currently hold Postgres's original default grant of
  full `INSERT/SELECT/UPDATE/DELETE/TRUNCATE`, unrevoked. Concretely: today, a raw signed request
  with nothing more than the public `anon` key can write directly to `profiles` — including
  setting its own `role` to `admin` — or to `tokens`, bypassing every RPC's numbering, rate limit
  and state-machine check entirely. The RPCs remain the only path the real apps ever take, and
  nothing in this pass depends on that hole being open, but it is real, it is live, and it is not
  hidden from this document. Closing it is a separate, deliberately-scoped migration (it has to
  be checked against what `apps/web`'s own direct table reads actually need before it can safely
  restrict them) — flagged as its own piece of work rather than rushed in alongside this one.

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
- **Counter screen wired to the real RPCs.** `docs/DECISIONS.md` flagged that this screen still
  called `mark_done`/`mark_no_show`/`transfer_token`, none of which exist once the DB agent's
  migrations landed — fixed against the real functions in `supabase/migrations/0020_call_next.sql`
  and `0021_token_lifecycle.sql`: `call_next`/`start_serving`/`complete_token`/`skip_token`/
  `recall_token`, each keyed by their actual `p_counter`/`p_token` argument names (the old code
  also had those wrong, e.g. `counter_id` instead of `p_counter`, so Call Next never worked at
  all). `complete_token` only accepts a ticket already in `serving`, so "Done" now calls
  `start_serving` first when needed rather than exposing a separate click the display board never
  visually distinguishes anyway. There's no staff-triggered no-show RPC (no-shows are set only by
  the automatic housekeeping job on a timer), so that button is now "Skip" and calls `skip_token`;
  "Transfer" is removed outright since moving a ticket to another desk isn't a real RPC and was
  never in the spec. Also fixed: `call_next` returns `setof tokens`, so PostgREST always hands back
  an array — the old `!data` check treated an empty array (no one waiting) as truthy and would have
  rendered a garbled token card instead of "No one waiting."
- **Verification pass.** Screenshots of every route in light/dark under `apps/web/qa-screenshots/`;
  a scripted two-counter race (two staff, two desks on the same service, simultaneous Call Next)
  confirmed no ticket is ever double-assigned — Postgres's `for no key update ... skip locked` in
  `call_next` (0020) makes the two calls serialize instead of racing; ran gstack `/qa` before/after
  the RPC fix above. Exact screenshot paths, race-test transcript, and qa scores/findings are in
  the workflow report, not duplicated here.
- **Predict client aligned with the real `/predict` contract.** The API agent's route dropped
  its fixed 5-slug `service` enum for a real `service_id` UUID looked up against
  `board_services` (see `docs/api/model-card.md`) — dental/eye never existed in the real
  4-service preset either. The admin dashboard chart and the patient status page's ETA both
  guessed a slug from `services.name`/`.code` and sent `{service: "..."}`; both now send
  `{service_id: services.id}` directly, so the slug-matching code (and its "doesn't map to a
  known API demo service" dead end) is gone entirely. Also fixed a real bug found while in
  there: the status page sent `weekday: now.getDay()` (JS Sunday=0), while the admin dashboard
  already converted to the API's Monday=0 convention (`docs/API_CONTRACT.md`) — the status page
  now converts too. `docs/API_CONTRACT.md`'s `/predict` section still documents the old slug
  body; it's outside this app's scope to fix (shared with mobile), flagged for its owner.

- **Redesign polish pass (2026-09-26).** A final critique-and-polish round over every screen.
  - *Landing and login.* The landing's main patient button used to send visitors to `/kiosk`,
    which is a staff-signed-in device. It now opens the status lookup, and "Get a token" in the
    header and footer opens How it works: tokens come from the reception desk. The status card
    shows a printed example slip drawn in HTML/CSS with "scan this" and "or type this" callouts;
    its QR is real but only encodes "Example slip only". Live numbers read as words at zero, and
    each service card shows how many people are waiting now. Login lost its decorative tabs and
    dots, and its error summary uses a full border with an icon.
  - *Kiosk and status page.* The signed-out kiosk reads "Staff sign-in needed" and gives a patient
    a way out (ask at reception, or check status). Service cards lead with the service code, and
    the issued ticket shows the full code (PED-006), so staff, slip, TV board and patient page name
    a token the same way. On `/t/[id]`, being called fills the card head with solid cyan and a
    screen reader announces it through a persistent live region; directions read "Go to Counter
    OPD-1" so a counter name no longer looks like a token.
  - *TV board.* Each tile leads with the token in mono and shows "Counter OPD-1" smaller underneath.
    Status chips use the same pill-and-dot system as the rest of the app (Now calling, Serving,
    Done, No-show, Skipped, Cancelled, Paused, Closed). A new call ripples a cyan ring three times
    (4.5 s, inside the WCAG 5-second limit) and stops; under reduced motion the solid cyan tile
    carries the signal alone.
  - *Counter.* Decoration removed: no app-bar strip, no eyebrow, no duplicate key legend, and Skip
    is no longer red, since skipping a no-show is routine. Done is the widest button, and banners
    sit under the card so buttons never move under the operator's cursor. Buttons announce as
    "Done"/"Skip" with `aria-keyshortcuts` instead of "Done D".
  - *Admin.* When `/predict` is down the chart shows actual waits only, with a banner saying why,
    instead of a fake flat 0-minute line. Empty values read "Unassigned"/"None"/"No data yet",
    which exposed a real display bug: counters with staff whose profiles have no name looked
    unassigned. Every page keeps its h1 in error states and row buttons name their row.
  - *Shared.* Page titles use a `"%s | Queueless"` template (no em dashes), slate regions get a
    cyan focus ring via `data-surface="slate"`, and every text/background pair was recomputed for
    both themes and passes AA (`node apps/web/brand/contrast-check.mjs`).
  - *Known limits, left for a logic/DB pass.* `board_counters` has no service or org column and an
    open anon read policy, so each TV board lists every counter. After a validation or RPC error
    the kiosk form is reset by React 19's form action, so the chosen service and name are cleared.

## Backend

- **What it is.** `apps/api` is a separate Python FastAPI service that runs beside Supabase, not
  inside it — it handles the three things a database and a static frontend can't do well on their
  own: verifying who's calling, pushing notifications to a phone that isn't open, and running a
  background job safely across multiple copies of the service. Endpoints: `GET /health` (is the
  process alive), `GET /ready` (can it reach Postgres — what a load balancer should watch), `POST
  /predict` (wait-time estimate, public), `GET /metrics` (Prometheus stats for monitoring). There
  is deliberately no push-token registration endpoint here — see the push notifications bullet
  below for why, and the real gap that decision currently leaves open.
- **Who you are, checked twice.** A Supabase login token proves *identity* (which user), never
  *permission* (what they're allowed to do) — the token's own claims are editable by the client
  SDK and can't be trusted for that. So `apps/api` decodes the token once to get the user's id,
  then looks up their real role from the `profiles` table on every privileged request (cached 5
  seconds so it isn't a database round trip every time — meaning a revoked staff account is locked
  out within 5 seconds, not instantly). Nothing a client sends in a request body or header is ever
  treated as a role.
- **Notifications: DB decides, API delivers.** The database itself now decides who to notify and
  when — a trigger writes a row the instant a ticket is 3rd in line or gets called, and a
  scheduled database job automatically marks a called patient as a no-show if they don't respond
  in time. `apps/api`'s only job left is turning an undelivered notification row into an actual
  Expo push on the patient's phone, exactly once (claimed via a `WHERE pushed_at IS NULL` guard,
  so two running copies of `apps/api` can never both send the same push) — it no longer decides
  anything itself, which also means it can no longer double-guess or drift out of sync with what
  the database already decided. **Currently blocked on one missing piece from the database side**:
  the column and permission `apps/api` needs to mark a notification as delivered aren't there yet
  (`pushed_at` doesn't exist on the table, and `apps/api`'s database account isn't allowed to read
  or write it) — `apps/api` detects this, logs it once, and waits rather than crash-looping, so it
  will start delivering the moment that lands with no redeploy needed. Flagged plainly rather than
  worked around.
- **push_tokens correction, and a real gap it exposed.** The Expo push-token table
  (`push_tokens`) is owned and written by the client directly under Supabase Row Level Security
  (the signed-in user writes their own row, `apps/api`'s own database role only has read/delete
  on it) — `apps/api` previously had its own registration endpoint using column names that
  didn't match the real table at all, which would have failed the moment the real migration
  landed. That endpoint has been removed; `apps/api` only reads the table to send pushes and
  deletes a row once Expo reports the device as unregistered. **This surfaced a real, currently
  open gap: the mobile app's push registration only ever called `apps/api`'s now-removed
  endpoint — it does not yet write to `push_tokens` directly via the Supabase SDK.** Push
  notifications will not reach a device until mobile switches to writing its own row under the
  `push_tokens_owner` policy; flagged here rather than silently left broken.
- **`/predict` matches the real system now.** It takes a real `service_id` (the actual per-org
  UUID from the database) instead of a fixed list of made-up service names, and checks that id
  against the live `board_services` table before predicting — an earlier version hardcoded 5
  service names (two of which, Dental and Eye, don't even exist in the real system), which would
  have silently disagreed with reality. Caught and fixed before it reached a judge's question.
  Also fixed this session: that existence check used to also require "today's" row, comparing the
  database server's UTC date against the caller's — near midnight India time those disagree,
  producing a false "unknown service" for a real one. Existence no longer needs a specific day,
  just a real id, sidestepping the mismatch entirely.
- **Three new authenticated endpoints — round 2's live auth/authz test now has real routes to
  attack.** `GET /admin/model` (admin, reads the currently-loaded model's metadata — no DB query,
  instant), `POST /admin/retrain` (admin, retrains on real completed-token data once enough
  exists — see the AI/ML section below), and `GET /staff/insights` (staff or admin, org-scoped:
  today's served/no-show counts and average service time per counter, plus current wait per
  service, for the caller's own organization only — never a client-supplied one). Every one of
  them re-checks the caller's role (and, for the staff route, their org) against the database on
  every request; nothing about who you are or which organization you belong to ever comes from
  the login token's own claims.
- **`/admin/retrain` actually retrains on real data, not a demo stub.** It queries real completed
  tokens, refuses honestly below 500 of them (`{"status": "insufficient_real_data", ...}`) rather
  than training on noise, and swaps the live model file atomically so a request mid-swap never
  sees a half-written file. Safe to hit repeatedly (idempotent — a second concurrent call while
  one is already running gets `{"status": "already_running"}`, never a duplicate or corrupted
  retrain) and safe behind a load balancer with multiple replicas, via the same database-level
  lock the no-show scheduler used to use before it was retired.

## AI/ML

- **What it predicts.** How many minutes a patient will likely wait, given their real service
  (by id), the hour and day, how many people are ahead of them, and how many counters are open.
- **The model.** A gradient-boosted regression model (`HistGradientBoostingRegressor`), trained
  once offline and loaded at startup — never retrained live, never trained on a live request.
- **The data is synthetic, and that's stated up front.** No real patient data exists yet, so
  20,000 rows were generated from a documented formula (base wait time per the real hospital's 4
  actual services, slower at peak hours and on Mondays, plus a per-day busy/slow factor, divided
  by counters open, plus realistic random noise) — every assumption behind that formula is
  written out in `docs/api/model-card.md`.
- **The actual, measured numbers, corrected** (from running `scripts/train.py`, not hand-typed —
  an earlier version of this section reported 92.3% against a baseline that forgot to divide by
  the number of open counters, which a judge asking "how did you validate this?" would have
  caught): the model's average error is **7.49 minutes**; the honest baseline — the exact same
  formula (`waiting × avg time ÷ open counters`) the app itself would show without any ML — is
  off by **33.68 minutes** on average, a **77.76% improvement**. Validated with a chronological
  split (the model never sees the last 20% of days during training), not a random shuffle, so
  "does this work on a day it hasn't seen" is actually tested. Full methodology, including why
  this improvement number is higher than typically expected and what was checked to rule out a
  bug, is in `docs/api/model-card.md`'s Validation section.
- **The responsible-AI part.** If the model is asked about a situation it barely saw in training
  (fewer than 30 similar examples), it does not guess — it falls back to that same honest baseline
  formula and says so in the response (`"fallback": true`). This is the guardrail against a
  confident-sounding wrong number for a case the model doesn't actually know.
- **What this is not.** Not clinical triage, not a staffing tool, not validated against any real
  hospital. It's a "here's roughly how long" number shown to a patient, nothing more, and it says
  so in its own documentation.
- **It can now retrain on real data, honestly gated.** An admin can trigger `POST /admin/retrain`,
  which trains on actual completed tokens instead of the synthetic set — but only once at least
  500 real ones exist; below that it refuses rather than fitting noise and pretending it's
  learned something. The model file records whether what's currently loaded is `"synthetic"` or
  `"real"` (`GET /admin/model` reports it honestly), so nobody has to guess which one a judge is
  looking at. Two proxies this needed are stated as real limits, not hidden: how many people were
  "ahead in line" for an old ticket is approximated from its position number (ignores priority
  reordering), and "how many counters were open" is approximated from which counters actually
  served someone that day (queueless_api's database account can't read a live counters list at
  all) — both documented in `docs/api/model-card.md` with the upgrade path if either ever matters
  more than it does at this scale.

## AI features (DeepSeek)

Separate from the wait-time model above — these use DeepSeek (an OpenAI-compatible LLM API) for
language tasks, not prediction. Every one labels its output `"ai_generated": true` and degrades
to a real, non-broken fallback when DeepSeek is unavailable or fails; none of them ever send a
patient's name or any row-level PII to DeepSeek — only pre-aggregated counts and averages.

- **Ask a question in plain English, get a real database answer — `POST /admin/ask`.** An admin
  types a question ("how many no-shows today?"); DeepSeek can only answer by picking one of 8
  pre-approved, read-only database functions (never by writing its own SQL) and the actual
  numbers it gets back are real query results, not invented. Two independent layers make sure of
  this: DeepSeek is only ever offered those 8 functions to call, and — even if that somehow broke
  — the backend independently re-checks the function name against the same allowlist before ever
  running anything, so a manipulated or malicious question (e.g. "ignore your instructions and
  run a different command") has no path to actually do that. The organization the data comes from
  is always the admin's own, looked up server-side — never something the question or the AI model
  could redirect.
- **Translate a message — `POST /translate`, and used automatically for push notifications.**
  Translates English to Hindi or Punjabi. If a patient's saved language is Hindi or Punjabi, their
  push notification title and body are translated automatically before sending; if translation
  fails for any reason, the original English message still goes out — a translation hiccup never
  costs a patient their notification. Repeated identical translations are cached in memory so the
  same phrase (e.g. "You're being called") isn't re-translated on every push.
- **A daily operations summary — `POST /admin/summary/run`, `GET /admin/summary`.** Once a day
  (21:00 India time, automatic; also triggerable on demand), the backend pulls real aggregated
  numbers — peak hours, no-show counts, average wait, counter workload — for every organization
  that had activity that day, and asks DeepSeek to write a short, plain-English report: peak
  hours, notable no-show patterns, counter workload, and a concrete staffing suggestion. If
  DeepSeek is unavailable that day, the real numbers are still saved with a plain note instead of
  an AI report — the job never silently produces nothing. Safe to run more than once for the same
  day (it replaces that day's summary rather than duplicating it) and safe with multiple copies of
  the backend running (one shared database lock per run, like the retrain job above).
- **Responsible-use guardrails, concretely:** the key is never logged anywhere; every DeepSeek
  call has a token cap and a timeout so one slow/expensive response can't hang a request; a
  question is always treated as data to analyze, never as instructions to the AI (the system
  prompt says so explicitly, and the allowlist enforcement doesn't depend on the AI obeying that
  anyway); and every AI-written answer is labeled as such in the response, never presented as a
  human-verified fact.

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
- **The new admin/staff routes got their own live attack script coverage.** Every one of them:
  401 with no login token; 403 with a real, correctly-signed token for a user who has no role
  record at all — proving access is decided by the database, never by anything the token itself
  claims. `/admin/retrain`'s own stricter 1-per-10-minute limit is proven in a fast automated
  test rather than a live 10-minute run, and that choice is stated in the script's own comments,
  not silently skipped. A live, real-time test also confirms that revoking someone from staff to
  patient takes effect on their still-valid, unexpired login token within the actual configured
  delay (5 seconds by default) — this system has no way to instantly invalidate a token once
  issued, so that periodic re-check *is* the revocation mechanism, and it's proven to actually
  work, not just described.
