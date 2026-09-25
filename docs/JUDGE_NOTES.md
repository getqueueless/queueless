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
