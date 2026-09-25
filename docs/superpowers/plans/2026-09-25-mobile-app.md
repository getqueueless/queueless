# Queueless Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deviation from template, disclosed:** this plan is executed inline, same session, by the author who wrote it — no fresh engineer reads it cold. Full verbatim code-per-step (the base writing-plans format) would be pure duplication under those conditions, and the project is a 12-24h hackathon under an explicit 20-minute time-box per stuck step. Tasks below carry file paths, exact contracts (RPC names, table names, env vars, auth options), and code only where it is non-obvious or exact values matter (client init, error map, ETA formula, realtime channel wiring). Screen JSX is written directly during execution, not pre-written here twice.

**Goal:** Build `apps/mobile`, the Expo patient app for Queueless — auth, live queue home, take-token flow, live token position, appointments, push/local notification fallback, history, settings — talking to the self-hosted Supabase backend other sessions are building in parallel.

**Architecture:** Expo Router file-based app, `(auth)` and `(app)` route groups gated by `onAuthStateChange`. All state comes from Supabase Postgres RPC calls + Realtime subscriptions (no custom backend calls except two optional, non-blocking API endpoints for push registration and ML wait prediction). Local fallbacks (estimate math, local notifications) exist wherever a dependency service might not be up, so the core flow (auth → take token → see live position) never blocks on anything but the DB.

**Tech Stack:** Expo SDK 57, React 19.2.3, Expo Router, `@supabase/supabase-js`, `expo-sqlite` (localStorage adapter), `expo-notifications`, `@react-native-community/netinfo`.

## Global Constraints

- Machine: CachyOS laptop, Node 22.14.0, pnpm 12.6.0. LAN IP confirmed this session: `10.33.5.219` (via `ip -4 addr`, not `hostname -I` — not supported on this box). Never hardcode it into committed source; only into gitignored `apps/mobile/.env`.
- Repo: `getqueueless/queueless`, worktree at `~/code/queueless-mobile` on branch `mobile`. Touch only `apps/mobile/` and this plan's own section of `docs/`. Root config (`pnpm-workspace.yaml`, `package.json`, `turbo.json`) is the DB session's — only the smallest possible addition if a root file is missing something `apps/mobile` strictly needs, as its own commit, called out explicitly.
- Git identity already set (`Yash Dhanda <260124161+yash-dhanda@users.noreply.github.com>`) — never touch `git config user.*`.
- No AI attribution in any commit. Every commit message ends with, exactly:
  ```
  Co-authored-by: Raghav <315327454+Raghav2477@users.noreply.github.com>
  Co-authored-by: Satyam Singh <323049544+singhsatyam3829@users.noreply.github.com>
  ```
- Conventional commit subjects (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). One logical step per commit, never batched. After every commit: `git pull --rebase origin main && git push origin HEAD:main`. On conflict in a shared file (`pnpm-lock.yaml`, `turbo.json`): keep both sides' additions. On conflict outside `apps/mobile/`: take the other side unless obviously wrong, then stop and flag.
- Expo SDK 57 / React 19.2.3 pinned via root `pnpm.overrides` — never bump.
- `apps/mobile/.env` gitignored already (`.env*` with `!.env.example` at repo root). Commit only `apps/mobile/.env.example` with placeholders. Never a real anon key.
- Supabase client (`apps/mobile/lib/supabase.ts`) must import `react-native-url-polyfill/auto` and `expo-sqlite/localStorage/install` before creating the client, with `auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }`.
- Env vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL`. Kong gateway on port 8000 → `http://10.33.5.219:8000` for a real phone on the same Wi-Fi (state this LAN-IP constraint in judge notes, not as a hidden hack).
- Auth is email+password only, autoconfirmed, no phone OTP, no guest/anonymous flow — every token ties to `profiles.id`. Don't re-litigate; don't build a guest path.
- Expo Go cannot receive remote push on Android since SDK 53 — the in-app Realtime banner + local-notification fallback is the *reliable* path and must work with zero push wiring; push registration is additive, not load-bearing.
- Priority (senior/pregnant) is staff-verified only, never self-declared in-app — no toggle, no writable column exists for it. The app's only "priority" UI is the large, legible token code for staff to scan/type.
- Time-box: 20 minutes stuck on a non-load-bearing step → cut it, log one line in `docs/DECISIONS.md`. Load-bearing (sign-in, take-token, live position, push-or-fallback) → keep going.
- `eas.json` content is fixed (given in Task 13) — do not invent a different shape. Never run `eas login` or `eas build` — leave the exact command for the user.
- Judge notes go in `docs/JUDGE_NOTES.md` under `## Mobile` (create the file with that heading if absent, never clobber `## Database`/`## API` sections). Every deviation from the source prompt logged in `docs/DECISIONS.md` as it happens, one line, not retroactively.

**RPC/table contract assumed** (confirm against `packages/db` generated types or `apps/api` docs once they land on `origin/main`; if they differ, the live contract wins and the difference gets one `docs/DECISIONS.md` line):

| Name | Kind | Notes |
|---|---|---|
| `services` | table | `id, name, is_open` |
| `board_services` | table, Realtime | `service_id, waiting_count, avg_service_secs, open_counters` (or equivalent) |
| `board_counters` | table, Realtime | per-service counter state, used for "called at Counter N" |
| `issue_token(p_service uuid)` | RPC | idempotent — a duplicate call while a ticket is still active returns the existing ticket, no error |
| `my_queue_status(p_token uuid)` | RPC | initial position/state snapshot for one token |
| `cancel_token(p_token uuid)` | RPC | |
| `tokens` | table, RLS own-row, Realtime | one row per ticket; `status`: `waiting`\|`called`\|`serving`\|`done`\|`no_show`\|`cancelled`\|`skipped` |
| `appointment_slots` | table | 15-minute slots per service |
| `book_appointment(p_slot uuid)` | RPC | |
| `cancel_appointment(p_appointment uuid)` | RPC | |
| `check_in(p_appointment uuid)` | RPC | mints a token, window `starts_at - 30min` to `starts_at + 15min` |
| `notifications` | table, RLS own-row, Realtime | `id, user_id, kind (called\|almost_turn\|...), read_at` |
| `profiles` | table | `id, full_name, phone` — only these two columns are user-writable |

---

### Task 0: Confirm coordination state, scaffold if the DB session hasn't landed it

**Files:**
- Create (only if scaffolding needed): `apps/mobile/**` via `create-expo-app`
- Create: `docs/API_CONTRACT.md` (only if `apps/api` hasn't published one)
- Modify: `docs/DECISIONS.md` (create if missing)

**Interfaces:**
- Produces: `apps/mobile/` Expo project skeleton that later tasks build on.

- [x] **Step 1:** `git fetch origin && git log origin/main --oneline -1` — checked at plan-write time: `origin/main` is still `9f3d534 chore: init repo with team git rules`, no `apps/mobile` tree yet. A background poll (every 2 min, up to 14 min) is already running to catch a late landing.
- [ ] **Step 2:** Re-check the poll's outcome before scaffolding (`cat` the background job's output). If `MOBILE_SCAFFOLD_FOUND` appears, `git pull --rebase origin main`, inspect what landed, and build on top of it instead of scaffolding — do not re-run `create-expo-app`.
- [ ] **Step 3:** If nothing landed after the poll window, scaffold:
  ```bash
  cd ~/code/queueless-mobile
  pnpm dlx create-expo-app@5 apps/mobile --template default --no-install --no-agents-md --yes
  pnpm --filter mobile exec expo install @supabase/supabase-js react-native-url-polyfill expo-sqlite expo-notifications expo-router
  ```
  If `pnpm --filter mobile` fails because the root workspace file doesn't exist yet (DB session hasn't landed `pnpm-workspace.yaml`), add the minimal root files needed to make `apps/mobile` buildable standalone, as their own commit, noting in the commit body that DB's landing may need to reconcile them.
- [ ] **Step 4:** Check `apps/api/README.md` and `docs/API_CONTRACT.md` on `origin/main`. If neither exists, write `docs/API_CONTRACT.md` with the §4 shape (`POST /push/register`, `GET /predict?service_id=`), mention it in this commit's message.
- [ ] **Step 5:** Commit: `chore: scaffold mobile app skeleton` (+ trailers), noting in `docs/DECISIONS.md` that mobile scaffolded itself because the DB skeleton hadn't landed after a 14-minute poll (only if Step 3 ran). Push per the rebase rule.

---

### Task 1: Supabase client + env + design tokens

**Files:**
- Create: `apps/mobile/lib/supabase.ts`
- Create: `apps/mobile/lib/errors.ts`
- Create: `apps/mobile/.env.example`
- Create: `apps/mobile/.env` (gitignored, real values)
- Create: `apps/mobile/lib/theme.ts`
- Create: `docs/DESIGN.md` section under `## Mobile` (or reuse `apps/web/DESIGN.md`/token file if it exists on `origin/main` by this point — check first)

**Interfaces:**
- Produces: `supabase` client singleton (`import { supabase } from '../lib/supabase'`), `mapErrorCode(code: string): string` from `lib/errors.ts`, `tokens` object from `lib/theme.ts` (colors, spacing, type scale) used by every screen.

- [ ] **Step 1:** `git fetch origin` and check for `apps/web/DESIGN.md` or a token file. If present, read it and mirror its palette/type scale in `lib/theme.ts` instead of inventing a second system; note the source in a comment-free way (just reuse the values).
- [ ] **Step 2:** Write `lib/supabase.ts`:
  ```ts
  import 'react-native-url-polyfill/auto'
  import 'expo-sqlite/localStorage/install'
  import { createClient } from '@supabase/supabase-js'

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

  export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  ```
- [ ] **Step 3:** Write `lib/errors.ts` with a small map (real Postgres/PostgREST error codes we know about: `already_active`, `service_closed`, `slot_taken`, `not_in_window`, network/`PGRST*` fallback) → plain-language strings, e.g.:
  ```ts
  const MESSAGES: Record<string, string> = {
    service_closed: 'This service is closed right now.',
    slot_taken: 'That slot was just booked by someone else.',
    not_in_window: 'Check-in opens 30 minutes before your slot.',
  }
  export function mapErrorCode(code: string | undefined, fallback = 'Something went wrong. Please try again.') {
    if (!code) return fallback
    return MESSAGES[code] ?? fallback
  }
  ```
  Log in `docs/DECISIONS.md`: "hand-rolled `lib/errors.ts`; replace with `packages/db`'s generated error map once it lands, to avoid duplicating it."
- [ ] **Step 4:** Write `apps/mobile/.env.example`:
  ```
  EXPO_PUBLIC_SUPABASE_URL=http://10.0.0.1:8000
  EXPO_PUBLIC_SUPABASE_ANON_KEY=replace-with-real-anon-key
  EXPO_PUBLIC_API_URL=http://10.0.0.1:8001
  ```
  Write real `apps/mobile/.env` with `EXPO_PUBLIC_SUPABASE_URL=http://10.33.5.219:8000`, the real anon key (from `supabase/.env` or the DB session's docs — if not yet available, leave a clearly-fake placeholder and log the gap in `docs/DECISIONS.md`), `EXPO_PUBLIC_API_URL=http://10.33.5.219:8001` (confirm API port from `apps/api` docs; default to 8001 if unstated, log if guessed).
- [ ] **Step 5:** Confirm `.env` is actually ignored: `git check-ignore apps/mobile/.env` must print the path. If it doesn't, stop — do not commit until the root `.gitignore` covers it (fix the minimal missing pattern as its own commit if needed).
- [ ] **Step 6:** `git add apps/mobile/lib apps/mobile/.env.example` (never the real `.env`) and commit `feat: add supabase client, error map, design tokens`.

---

### Task 2: Auth — sign-up, sign-in, root redirect

**Files:**
- Create: `apps/mobile/app/(auth)/sign-in.tsx`
- Create: `apps/mobile/app/(auth)/sign-up.tsx`
- Create: `apps/mobile/app/(auth)/_layout.tsx`
- Create: `apps/mobile/app/(app)/_layout.tsx`
- Create: `apps/mobile/app/_layout.tsx` (root — session listener + redirect)
- Create: `apps/mobile/lib/useSession.ts`

**Interfaces:**
- Consumes: `supabase` from Task 1.
- Produces: `useSession()` hook returning `{ session: Session | null, loading: boolean }`, consumed by every later screen that needs `session.user.id`.

- [ ] **Step 1:** `lib/useSession.ts` — wraps `supabase.auth.getSession()` + `supabase.auth.onAuthStateChange` in a hook.
- [ ] **Step 2:** Root `app/_layout.tsx` uses `useSession()`; while `loading`, render a splash/spinner; once resolved, redirect to `/(app)` if `session` else `/(auth)` (Expo Router `<Redirect>` or `router.replace`).
- [ ] **Step 3:** `sign-in.tsx`: email + password fields, calls `supabase.auth.signInWithPassword({ email, password })`, maps error via `mapErrorCode(error?.code)`, shows inline error text (not just a toast — this is the entry point, must be legible for anxious/elderly users per the calm-clinical design brief).
- [ ] **Step 4:** `sign-up.tsx`: same fields, `supabase.auth.signUp({ email, password })`. Since autoconfirm is on, a successful sign-up should already carry a session — no "check your email" step.
- [ ] **Step 5:** Manual verification (Expo Go, real device on the same Wi-Fi): sign up a fresh email, confirm it lands in `(app)`, kill and reopen the app, confirm the session persists (no re-login).
- [ ] **Step 6:** Commit `feat: add email/password auth and session-gated routing`.

---

### Task 3: Home — live service list with wait estimate

**Files:**
- Create: `apps/mobile/app/(app)/index.tsx`
- Create: `apps/mobile/lib/predict.ts`

**Interfaces:**
- Consumes: `supabase`, `useSession`.
- Produces: `estimateWaitSeconds(waitingCount: number, avgServiceSecs: number, openCounters: number): number` (pure function, testable) from `lib/predict.ts`.

- [ ] **Step 1:** `lib/predict.ts`:
  ```ts
  export function estimateWaitSeconds(waitingCount: number, avgServiceSecs: number, openCounters: number): number {
    return Math.round((waitingCount * avgServiceSecs) / Math.max(openCounters, 1))
  }
  ```
  This is the one piece of non-trivial branching logic on this screen — leave a `demo()`/assert self-check at the bottom of the file per the plan's own testing bar:
  ```ts
  function demo() {
    console.assert(estimateWaitSeconds(10, 300, 2) === 1500, 'basic case')
    console.assert(estimateWaitSeconds(5, 300, 0) === 1500, 'zero open counters clamps to 1')
  }
  ```
- [ ] **Step 2:** `index.tsx`: on mount, `select * from services where is_open = true` joined/paired with `board_services` rows; subscribe to `board_services` over Realtime (`supabase.channel('board_services').on('postgres_changes', { event: '*', schema: 'public', table: 'board_services' }, handler)`) and patch local state on change — no polling.
- [ ] **Step 3:** For each service card: try `GET {EXPO_PUBLIC_API_URL}/predict?service_id=...` with a short timeout (e.g. `AbortSignal.timeout(1500)`); on success show `wait_seconds` labeled "predicted"; on failure/timeout/no API, fall back to `estimateWaitSeconds(...)` from `board_services` labeled "estimate" — never block the screen on the fetch (fire per-card, don't await before first render).
- [ ] **Step 4:** Tapping a card opens the take-token confirm sheet (Task 4).
- [ ] **Step 5:** Manual verification: with the DB session's seed data (or manually inserted test rows once `supabase/` seed lands), confirm the list renders and a `board_services` row change (via SQL update in another session) updates the card live within a second or two, no app refresh.
- [ ] **Step 6:** Commit `feat: add live service list with predicted/estimated wait`.

---

### Task 4: Take token — confirm sheet, idempotent RPC, navigate

**Files:**
- Create: `apps/mobile/app/(app)/take-token-sheet.tsx` (or inline modal component in `index.tsx` — decide based on Expo Router modal support once scaffolding is in place)
- Modify: `apps/mobile/app/(app)/index.tsx`

**Interfaces:**
- Consumes: `mapErrorCode`, `supabase`.
- Produces: navigation to `/(app)/token/[id]` with the ticket id from `issue_token`.

- [ ] **Step 1:** Small bottom sheet: service name, "Confirm" button. Disable the button the instant it's tapped (optimistic-safe per §3.6 — prevents double-submit, RPC is idempotent anyway) and re-enable only on error.
- [ ] **Step 2:** Call `supabase.rpc('issue_token', { p_service: serviceId })`. On success (including a same-ticket "already_active" response — the RPC returns the existing ticket either way per spec, not a Postgres error), `router.push('/(app)/token/' + ticket.id)`. On any other error code, `Toast`/inline alert with `mapErrorCode(error.code)`, re-enable the button.
- [ ] **Step 3:** Manual verification: tap Confirm twice fast (simulate double-tap by tapping again before nav completes) — must not create two tickets and must not show an error on the second tap.
- [ ] **Step 4:** Commit `feat: add take-token flow with idempotent double-tap handling`.

---

### Task 5: Token detail — live position, status, cancel

**Files:**
- Create: `apps/mobile/app/(app)/token/[id].tsx`
- Create: `apps/mobile/components/PriorityInfoCard.tsx`
- Create: `apps/mobile/components/TokenProgress.tsx`

**Interfaces:**
- Consumes: `supabase`.
- Produces: nothing consumed further (leaf screen), but is the shared navigation target for Task 4 and Task 7's check-in.

- [ ] **Step 1:** On mount, `supabase.rpc('my_queue_status', { p_token: id })` for the initial snapshot (`position`, `eta_seconds`, `status`, `counter`).
- [ ] **Step 2:** Subscribe to the single `tokens` row (`postgres_changes`, `filter: id=eq.${id}`) and to the service's `board_counters` row, patch state on either. RLS already restricts the `tokens` row to the caller.
- [ ] **Step 3:** Render: token code large and high-contrast (this doubles as what staff scan/type — treat font size and contrast as a correctness requirement, not just style), `TokenProgress` (waiting → called → serving → done), "about N min" from `eta_seconds`, "Counter N" once called.
- [ ] **Step 4:** `PriorityInfoCard`: static info card explaining senior/pregnant patients get a 15-minute arrival head start once staff verify them by scanning/typing the code on this screen. No toggle, no writable state — this is a pure info component, confirm it has zero props that could become a self-report control.
- [ ] **Step 5:** Cancel button (visible only while `status === 'waiting'`) calls `supabase.rpc('cancel_token', { p_token: id })`, then navigates back to home on success.
- [ ] **Step 6:** Manual verification: take a token, then from a second client (`psql` or the web session's counter console once it exists) update the `tokens` row status to `called` and set a `board_counters` row — confirm the phone updates live without a manual refresh.
- [ ] **Step 7:** Commit `feat: add live token detail screen with realtime position and cancel`.

---

### Task 6: Priority contract check (no code — verification task)

**Files:** none created; read-only check against `profiles` RLS/grants once `supabase/` migrations are visible on `origin/main`.

- [ ] **Step 1:** `git fetch origin` and inspect `supabase/migrations/` (or wherever DB puts grants) for `profiles` to confirm only `full_name`/`phone` are patchable and there is no writable priority/senior/pregnant column reachable from the anon/authenticated role. If a writable column *does* exist, do not use it — this is a deliberate product decision (§3.7), not a missing feature; log the discrepancy in `docs/DECISIONS.md` and leave the UI as the static info card from Task 5.
- [ ] **Step 2:** No commit unless a decision line was added to `docs/DECISIONS.md`, in which case commit that alone: `docs: note profiles priority-column check`.

---

### Task 7: Appointments — list, book, cancel, check-in

**Files:**
- Create: `apps/mobile/app/(app)/appointments/[serviceId].tsx`
- Create: `apps/mobile/lib/appointmentWindow.ts`

**Interfaces:**
- Consumes: `supabase`, `mapErrorCode`.
- Produces: `isCheckInWindow(startsAt: Date, now: Date): boolean` (pure, testable).

- [ ] **Step 1:** `lib/appointmentWindow.ts`:
  ```ts
  const THIRTY_MIN_MS = 30 * 60 * 1000
  const FIFTEEN_MIN_MS = 15 * 60 * 1000

  export function isCheckInWindow(startsAt: Date, now: Date): boolean {
    const diff = startsAt.getTime() - now.getTime()
    return diff <= THIRTY_MIN_MS && diff >= -FIFTEEN_MIN_MS
  }
  ```
  With a `demo()` self-check covering: well before window (false), exactly at −30min boundary (true), mid-window (true), exactly at +15min boundary (true), just after (false).
- [ ] **Step 2:** List open `appointment_slots` for the service (`select * from appointment_slots where service_id = ... and starts_at > now() order by starts_at`).
- [ ] **Step 3:** "Book" calls `supabase.rpc('book_appointment', { p_slot: slotId })`; on `slot_taken` (or equivalent), refetch the list and show the mapped error rather than leaving a stale "Book" button on a now-taken slot.
- [ ] **Step 4:** Booked slots show "Cancel" (`cancel_appointment`) and, once `isCheckInWindow(...)` is true, "Check in" — calls `supabase.rpc('check_in', { p_appointment: appointmentId })`, then `router.push('/(app)/token/' + result.id)` same as a walk-in token.
- [ ] **Step 5:** Manual verification: book a slot with a `starts_at` inserted 25 minutes in the future (inside window), confirm "Check in" appears and mints a token; try one outside the window, confirm it's hidden and, if forced, `check_in` returns `not_in_window` and shows the mapped message.
- [ ] **Step 6:** Commit `feat: add appointment booking, cancellation and check-in`.

---

### Task 8: Push registration + reliable in-app notification banner

**Files:**
- Create: `apps/mobile/lib/notifications.ts`
- Create: `apps/mobile/components/NotificationBanner.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `supabase`, `EXPO_PUBLIC_API_URL`.
- Produces: `registerForPushNotificationsAsync(): Promise<string | null>` from `lib/notifications.ts`.

- [ ] **Step 1:** `lib/notifications.ts`: request permission, create an Android notification channel, call `Notifications.getExpoPushTokenAsync()` guarded in a try/catch (this throws or no-ops in Expo Go on Android per SDK 53 — catch and return `null`, don't crash the app). On a real token, `POST {EXPO_PUBLIC_API_URL}/push/register` with `Authorization: Bearer <supabase access token>` and body `{ expo_push_token }`; treat failure as non-fatal (API may not be up yet — log and continue, per §4's "optional at runtime").
- [ ] **Step 2:** In `(app)/_layout.tsx`, on mount (once session exists): call registration (fire-and-forget, don't block render) AND subscribe to `notifications` rows for `user_id = session.user.id` over Realtime. On a new row with `kind` in `('called', 'almost_turn')`, show `NotificationBanner` (in-app toast/banner, not a system notification — this is the reliable path per §3.6) and also fire a local notification (`Notifications.scheduleNotificationAsync` with `trigger: null`) so it surfaces even if the app is backgrounded, which works in Expo Go unlike remote push.
- [ ] **Step 3:** Tapping the banner marks the row read: `supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', row.id)` (RLS allows this on the caller's own rows) and navigates to the relevant token.
- [ ] **Step 4:** Manual verification on a real device via Expo Go: insert a `notifications` row for the signed-in user from another session/`psql`, confirm the in-app banner and local notification both fire without any push token ever having been obtained — this is the test that the fallback is load-bearing, not decorative.
- [ ] **Step 5:** Commit `feat: add push registration with local-notification fallback for Expo Go`.

---

### Task 9: History

**Files:**
- Create: `apps/mobile/app/(app)/history.tsx`

- [ ] **Step 1:** Query `tokens` and `appointments` for the signed-in user where `status in ('done','no_show','cancelled','skipped')`, `order by` the relevant timestamp desc, RLS already scopes to caller — merge and sort client-side by a common timestamp field, render newest first.
- [ ] **Step 2:** Manual verification: cancel a token from Task 5, confirm it appears here.
- [ ] **Step 3:** Commit `feat: add history screen for past tokens and appointments`.

---

### Task 10: Settings — language placeholder, sign out

**Files:**
- Create: `apps/mobile/app/(app)/settings.tsx`

- [ ] **Step 1:** Language row: "English" selected/active, "हिन्दी (Hindi)" rendered but disabled (no i18n infra — a hardcoded second string is enough per the time-box; don't build a locale system for one label).
- [ ] **Step 2:** Sign out button → `supabase.auth.signOut()`, root layout's `onAuthStateChange` handles the redirect back to `(auth)` automatically (already wired in Task 2 — don't add a second manual redirect here).
- [ ] **Step 3:** Commit `feat: add settings screen with sign out`.

---

### Task 11: Offline banner + reconnect refetch

**Files:**
- Create: `apps/mobile/lib/useNetworkStatus.ts`
- Create: `apps/mobile/components/OfflineBanner.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`

**Interfaces:**
- Produces: `useNetworkStatus(): { isConnected: boolean }`.

- [ ] **Step 1:** Before adding a dependency: check whether `@react-native-community/netinfo` is already a transitive dep of something installed (`pnpm why @react-native-community/netinfo` inside `apps/mobile`) or whether `expo-network` is already present via Expo SDK. Use whichever is already there; only add `@react-native-community/netinfo` if neither is available.
- [ ] **Step 2:** `useNetworkStatus` wraps the chosen API's subscription. `OfflineBanner` renders a slim top banner only while `!isConnected`.
- [ ] **Step 3:** On the `isConnected` transition from `false` → `true`, each screen with a Realtime subscription re-runs its initial `select` (the Supabase client reconnects its own socket automatically, but events during the outage may have been missed) — implement as a small shared `onReconnect(callback)` hook screens opt into, not a global refetch-everything call.
- [ ] **Step 4:** Manual verification: toggle airplane mode on the test device mid-session on the token detail screen, confirm the banner appears, turn it back on, confirm the banner disappears and the token's status is re-fetched.
- [ ] **Step 5:** Commit `feat: add offline banner with reconnect refetch`.

---

### Task 12: `app.json` — stable identity for EAS

**Files:**
- Modify: `apps/mobile/app.json`

- [ ] **Step 1:** Set a stable `expo.slug` (`queueless-mobile`) and `expo.android.package` (`com.queueless.mobile` or similar reverse-domain id — pick one and never change it, EAS ties builds to it).
- [ ] **Step 2:** Commit `chore: set stable app slug and android package for EAS`.

---

### Task 13: `eas.json`

**Files:**
- Create: `apps/mobile/eas.json`

- [ ] **Step 1:** Write exactly:
  ```json
  {
    "cli": { "appVersionSource": "remote" },
    "build": {
      "development": { "developmentClient": true, "distribution": "internal" },
      "preview": {
        "distribution": "internal",
        "android": { "buildType": "apk" }
      },
      "production": { "autoIncrement": true }
    },
    "submit": { "production": {} }
  }
  ```
- [ ] **Step 2:** Do not run `eas login` or `eas build`. Commit `chore: add eas build profiles`.

---

### Task 14: Judge notes, decisions, final polish pass

**Files:**
- Modify: `docs/JUDGE_NOTES.md` (append any features whose per-feature note wasn't already written during their own task — Tasks 1-13 should each have logged theirs already; this task is the sweep, not the first write)
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1:** Confirm every feature task (2-13) has a `## Mobile` entry in `docs/JUDGE_NOTES.md` naming the real RPC/table it talks to and why that approach over an easier one (e.g. why Realtime over polling, why local-notification fallback over relying on remote push). Fill any gaps now.
- [ ] **Step 2:** Run an `impeccable` critique pass (per the source prompt's §2) over the built screens; fix what's cheap, log the rest in `docs/DECISIONS.md` as deliberately not fixed.
- [ ] **Step 3:** Commit `docs: finalize judge notes and decisions log`.

---

### Task 15: Final report

No files — deliver in chat per the source prompt's §7: every screen with its RPC/table/endpoint, exact run instructions (`pnpm --filter mobile start`, Expo Go QR flow, the one `eas build --profile preview --platform android` command left for the user), what's genuinely live vs. documented fallback, `git log --oneline` since session start, anything blocked.
