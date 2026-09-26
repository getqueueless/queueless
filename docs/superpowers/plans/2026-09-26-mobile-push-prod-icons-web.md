# Mobile: push registration, prod pointing, app icon, web bundling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Short plan by request. Code is written out only where the exact contract matters (Task 1). Tasks 1, 3 and 4 touch disjoint files, so they run in parallel. Implementers do not commit; the orchestrator commits each slice as its own small commit.

**Goal:** Real push-token registration against `public.push_tokens`, the app pointed at prod and verified there, brand icon and splash for the EAS preview APK, and `expo start --web` bundling.

**Architecture:** The mobile client writes its own `push_tokens` row through the Supabase client under owner-only RLS (no `apps/api` hop). The DB half lives in a pure module (`src/lib/push-tokens.ts`, no React Native imports), so a Node check script can run the same shipped code against a live Supabase. Web gets a platform-split storage polyfill so `expo-sqlite` never enters the web bundle.

**Tech Stack:** Expo SDK 57, expo-notifications 57.0.21, @supabase/supabase-js 2.117, Node 22.14 (`--experimental-strip-types`), rsvg-convert, ImageMagick.

## Global Constraints

- Touch only `apps/mobile/` and the mobile parts of `docs/`. Git identity is already set; never change it.
- No AI attribution. Every commit ends with the Raghav and Satyam `Co-authored-by` trailers from `CLAUDE.md`.
- One small commit per step, then `git pull --rebase origin main && git push origin HEAD:main`.
- `.env*` stays gitignored. Never commit a key. Never print or copy the VPS `SERVICE_ROLE_KEY` or `POSTGRES_PASSWORD`.
- Do not run `eas login`, `eas init` or `eas build`.
- If something fights you for 20+ minutes, take its fallback or cut it, and log why in `docs/DECISIONS.md`.

## Facts that shape the plan (checked 2026-09-26)

- `getExpoPushTokenAsync()` throws `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` when there is no `extra.eas.projectId` (`expo-notifications/build/getExpoPushTokenAsync.js:52`). `app.json` has none, and creating one needs `eas init`, which needs `eas login`. So no device mints a real Expo token until someone runs `eas init`. The DB half is verified with the shipped module against prod instead, and the report says so.
- `Notifications.addPushTokenListener()` **throws** in Expo Go on Android (`warnOfExpoGoPushUsage.js`: `throw` when `isRunningInExpoGo()` and Android). It must be wrapped, or the app crashes on the demo path. On web it only warns.
- `apps/api/app/notifications.py` deletes a `push_tokens` row when Expo answers `DeviceNotRegistered`, so stale tokens clean themselves up. Token rotation only needs the same upsert again.
- An upsert whose `ON CONFLICT` hits a row owned by another account fails RLS with SQLSTATE `42501`.
- Prod `ANON_KEY` comes from `/opt/queueless/supabase/.env` on the VPS (`ubuntu@135.148.43.147`). It decodes to `role: anon`; `auth/v1/health` and `rest/v1/services` both answer 200 with it.

---

### Task 1: Push token registration straight to `push_tokens`

**Files:**
- Create: `apps/mobile/src/lib/push-tokens.ts`
- Create: `apps/mobile/scripts/check-push-tokens.mjs`
- Modify: `apps/mobile/src/lib/notifications.ts`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx:62-65`
- Modify: `apps/mobile/src/app/(app)/(tabs)/settings.tsx:25-35`

**Interfaces:**
- Produces: `savePushToken(client, userId, token, platform): Promise<string | null>` (null = saved, else the error code), `deletePushToken(client, token): Promise<boolean>`, `OWNED_BY_ANOTHER_ACCOUNT = '42501'`; from `notifications.ts`: `registerForPushNotificationsAsync()`, `unregisterPushTokenAsync()`, `watchPushTokenRotation(): () => void`.

- [ ] **Step 1: Pure DB module** `src/lib/push-tokens.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type PushPlatform = 'ios' | 'android' | 'web';

/** Postgres insufficient_privilege: RLS refused the ON CONFLICT update because another account owns the row. */
export const OWNED_BY_ANOTHER_ACCOUNT = '42501';

/**
 * Upserts this device's Expo token under owner-only RLS. `expo_token` is globally unique, so
 * onConflict turns a re-registration into a no-op instead of a 23505. Returns null when saved,
 * otherwise the error code.
 */
export async function savePushToken(
  client: SupabaseClient,
  userId: string,
  token: string,
  platform: PushPlatform,
): Promise<string | null> {
  const { error } = await client
    .from('push_tokens')
    .upsert({ user_id: userId, expo_token: token, platform }, { onConflict: 'expo_token' });
  return error ? error.code || error.message : null;
}

/** Deletes one token's row. Needs a live session: RLS lets only the owner delete it. */
export async function deletePushToken(client: SupabaseClient, token: string): Promise<boolean> {
  const { error } = await client.from('push_tokens').delete().eq('expo_token', token);
  return !error;
}
```

- [ ] **Step 2: Rewrite `notifications.ts`.** Keep `setNotificationHandler`, the Android channel, the permission flow and `showLocalNotification` as they are. After `getExpoPushTokenAsync()`, read the user id from `supabase.auth.getSession()` and call `savePushToken(supabase, userId, token, Platform.OS as PushPlatform)`. On null, cache the token in a module variable `registeredToken`. On `OWNED_BY_ANOTHER_ACCOUNT`, log `console.log('[push] token belongs to a different account on this device')`. Log any other code as a non-fatal failure. Never throw. Delete `registerTokenWithApi`, `getOrCreateDeviceId` and `DEVICE_ID_KEY` entirely. Add:
  - `unregisterPushTokenAsync()`: when `registeredToken` is set, call `deletePushToken`, clear the cache on success, and swallow errors.
  - `watchPushTokenRotation()`: `addPushTokenListener(() => registerForPushNotificationsAsync())` inside try/catch (it throws in Expo Go on Android). Return the unsubscribe, or a no-op.

- [ ] **Step 3: `(app)/_layout.tsx`.** Replace the `[session]` effect with one keyed on `userId`: call `registerForPushNotificationsAsync()`, then `return watchPushTokenRotation();`. Do not touch the Realtime and local-notification effects.

- [ ] **Step 4: `settings.tsx` `handleSignOut`.** `await unregisterPushTokenAsync()` **before** `supabase.auth.signOut()`. After sign-out, RLS can no longer see the row. The call never throws, so a failed cleanup never blocks sign-out.

- [ ] **Step 5: Check script** `scripts/check-push-tokens.mjs`. It imports `../src/lib/push-tokens.ts` and runs with `node --experimental-strip-types`. Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `JWT_A`, `JWT_B` (two real user sessions). It asserts:
  1. A saves a token (null).
  2. A saves the same token again (null, no 23505).
  3. B saving the same token gets `42501`.
  4. B's delete leaves A's row intact.
  5. A's delete removes the row.
  6. A cannot read the row afterwards.

  It uses a unique synthetic `ExponentPushToken[check-…]` and deletes it in `finally`. Run it against the local stack first, then prod.

- [ ] **Step 6: Verify.** Run `pnpm --filter mobile check-types` and `pnpm --filter mobile lint`, then run the check script against the local stack. Commit: `feat: register push tokens directly in push_tokens under RLS`, then `feat: re-register on push token rotation and delete this device's token on sign-out`.

### Task 2: Point at prod and verify there

- [x] Write the prod anon key and URLs into the gitignored `apps/mobile/.env`, and drop the stale comment (done 2026-09-26, not committed).
- [ ] Run the OTP round trip on prod through the app UI (web build, Task 4). Use a fresh address, receive the real email, enter the code, and see name entry. Confirm `profiles.full_name` with `psql` inside `supabase-db` on the VPS.
- [ ] Run the check script against prod with two real OTP sessions. Confirm the row with `psql` on the VPS while it exists, and confirm it is gone after the delete.
- [ ] Take a token on prod, watch it live, then cancel it so the demo queue stays clean.

### Task 3: App icon and splash (EAS preview APK)

**Files:** `apps/mobile/assets/images/{icon,favicon,android-icon-foreground,android-icon-monochrome,splash-icon}.png`, delete `android-icon-background.png`, `apps/mobile/app.json`, `apps/mobile/assets/expo.icon/`.

- [ ] `icon.png` 1024×1024 from `apps/web/src/app/icon.svg`, full bleed with no `rx` (launchers mask their own corners, and iOS rejects alpha). `favicon.png` 196×196 from the same SVG as is.
- [ ] `android-icon-foreground.png` 1024×1024, transparent. Draw `queueless-mark-inverse.svg`'s two paths on a 108×108 canvas at `translate(29.25 32) scale(2.75)`. The farthest point, the slip's corner, then sits about 32 dp from the centre, inside the 33 dp safe circle. Check it with an ImageMagick alpha trim. `android-icon-monochrome.png` is the same file.
- [ ] `splash-icon.png`: the inverse mark trimmed tight at 228 px wide (3× the `imageWidth: 76`).
- [ ] `app.json`: set `adaptiveIcon.backgroundColor` to `#1a3237`, drop `backgroundImage` and delete its PNG, and set the splash `backgroundColor` to `#1a3237`.
- [ ] iOS `expo.icon` (best effort): swap the layer for the brand mark, set `fill.automatic-gradient` to slate-teal `extended-srgb:0.10196,0.19608,0.21569,1.00000`, and drop the template `grid.png` layer.
- [ ] Theme AA check against `apps/web/brand/BRAND.md`. `theme.ts` has neither `#0a95ae` nor `#087589`. Display cyan text (`TwoToneHeading`, the Home card numbers) uses `#0cb7d6`, which is 2.40:1 on white, and `onPrimary` puts white on cyan fills. Fix: add `primaryDisplay` (`#0a95ae` light, `#3fd6f0` dark), use it for those two, and set the light `onPrimary` to ink `#252525`, as BRAND.md asks ("use ink instead").
- [ ] Commits: `feat: WaitWise icon, adaptive icon and splash for Android`, `feat: WaitWise iOS icon layer`, `fix: AA-safe cyan display text and ink on cyan fills`.

### Task 4: Expo web bundling

- [ ] Keep `expo-sqlite/localStorage/install` out of the web bundle. Use a platform split (`storage-polyfill.ts` imports it; `storage-polyfill.web.ts` is empty), not a runtime `if`, because Metro bundles every static `require` whatever its condition. On web, leave supabase-js `storage` unset: it uses `window.localStorage` in the browser and memory during static rendering in Node.
- [ ] Make static rendering safe. `web.output` is `"static"`, so each route renders in Node, where `localStorage` does not exist. Guard the module-level uses. If static rendering fights for 20+ minutes, set `web.output: "single"` and log why.
- [ ] Re-check whether `metro.config.js`'s `wasm` asset rule is still needed. Delete it if the web bundle no longer reaches `expo-sqlite`.
- [ ] Verify: `pnpm --filter mobile exec expo export -p web` succeeds, and `expo start --web` renders `/` (the auth screen) and `/password-fallback` in a real browser, with screenshots. Commit: `fix: bundle Expo web by keeping expo-sqlite out of the web build`.

### Task 5: Docs, critique, review

- [ ] `docs/JUDGE_NOTES.md` `## Mobile`: the push rewrite (direct to Postgres under RLS: one less hop, one less service that can be down, and the same pattern the notifications reads use) and prod pointing.
- [ ] `docs/DECISIONS.md`: the multi-account-per-device push gap, where the anon key came from, the EAS `projectId` blocker, and anything time-boxed away.
- [ ] Run an impeccable critique of the changed screens, then `/review` on the session diff. Address what they find.
