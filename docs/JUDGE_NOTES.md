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
