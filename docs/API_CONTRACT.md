# API contract — mobile ⇄ apps/api

Originally written by the mobile session as a proposal, before `apps/api` had published either
route. Both routes have since landed with a different shape than proposed — this file now
documents what's actually live (`apps/api/app/routes/push_tokens.py`,
`apps/api/app/routes/predict.py`), which is the source of truth; mobile's client code in
`apps/mobile/src/lib/notifications.ts` and `apps/mobile/src/app/(app)/(tabs)/index.tsx` was
updated to match.

Both endpoints are **optional at runtime** for the mobile app: a missing, slow, or erroring API
never blocks a screen. The queue and position (home screen's local estimate, the in-app/local-
notification path) always come from Supabase directly; these two endpoints are enhancements.

## `POST /push-tokens`

Registers an Expo push token for the signed-in user. `204` on success.

- Header: `Authorization: Bearer <supabase access token>` — the API verifies it to get the user id.
- Body: `{"token": "ExponentPushToken[...]", "device_id": "<stable per-install id, [\w-]{1,120}>"}`
  (mobile generates and persists one in `localStorage` on first run — no device-id API installed).

## `POST /predict`

Returns a predicted wait in minutes for the fixed 5-service Hospital OPD demo preset. No auth.

- Body: `{"service": "general_opd"|"pediatrics"|"ortho"|"dental"|"eye", "hour": 0-23, "weekday": 0-6 (0=Monday, matches apps/api/scripts/generate_training_data.py — NOT JS Date#getDay()'s 0=Sunday), "queue_len_ahead": 0-500, "counters_open": 1-50}`
- Response: `{"predicted_wait_minutes": <float>, "fallback": <bool>, "reason": <string|null>}`
- Mobile maps `services.name` → one of the 5 slugs with a best-effort substring match
  (`matchServiceSlug` in `index.tsx`) since there's no confirmed slug column on `services` yet
  (migrations hadn't landed while this was written). If a service's name doesn't match any known
  slug, mobile skips the call entirely and uses its local estimate — never sends a guessed value.
- Any non-2xx, timeout, or unmatched service name → the client falls back to computing an
  estimate directly from `board_services` (`waiting_count * avg_service_secs / max(open_counters,
  1)`), labeled "estimate" instead of "predicted".

## Local dev

Mobile assumes `apps/api` is reachable at `http://<laptop LAN IP>:8001` in dev
(`EXPO_PUBLIC_API_URL`) — 8001 is still a guess (nothing in `apps/api` pins a port; 8000 is
Kong's, not this service's). If `apps/api` ends up on a different port, update
`apps/mobile/.env`/`.env.example` and this line, nothing else.
