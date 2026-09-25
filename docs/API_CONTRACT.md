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

Returns a predicted wait in minutes for one real service. No auth.

- Body: `{"service_id": "<real services.id UUID>", "hour": 0-23, "weekday": 0-6 (0=Monday, matches apps/api/scripts/generate_training_data.py — NOT JS Date#getDay()'s 0=Sunday), "queue_len_ahead": 0-500, "counters_open": 1-50}`
- Response: `{"predicted_wait_minutes": <float>, "fallback": <bool>, "reason": <string|null>}`
- `service_id` must exist in `board_services` for today (`queueless_api`'s DB role has no grant
  on `services` itself) — a 404 (`unknown service_id for today`) is expected and harmless for a
  service with no board row yet, same as any other non-2xx below.
- **Superseded contract, noted for history:** an earlier version of this route took a fixed
  5-slug `service` string (`general_opd`/`pediatrics`/`ortho`/`dental`/`eye`) instead of a real
  `service_id` — mobile originally guessed a slug from `services.name`. That's gone; both mobile
  (`(app)/(tabs)/index.tsx`) and web (`apps/web/src/app/admin/_lib/predict.ts`,
  `apps/web/src/app/t/[id]/predict.ts`) now send `service_id` directly.
- Any non-2xx, timeout, or missing API URL → the client falls back to computing an estimate
  directly from `board_services` (`waiting_count * avg_service_secs / max(open_counters, 1)`),
  labeled "estimate" instead of "predicted".

## `POST /admin/ask` (proposed — not yet implemented)

Checked `apps/api/app/routes/admin.py` on `origin/main` just now: it only has `/admin/model` and
`/admin/retrain`, so `apps/mobile/src/app/(app)/(tabs)/admin/ai.tsx` ("Ask your data") calls this
route against the contract below, written by the mobile session. Every call 404s until
`apps/api` implements it; the screen treats that as an honest "Not available yet" empty state.

- Header: `Authorization: Bearer <supabase access token>`.
- Body: `{"org_id": "<uuid>", "question": "<free text>"}`.
- Response: `{"answer": "<text>", "chart": {"labels": string[], "values": number[]} | null}` —
  `chart` is optional and only for simple bar-chart-shaped answers.

## `GET /admin/summary` (proposed — not yet implemented)

Returns the latest generated daily summary for an org.

- Query: `?org_id=<uuid>`.
- Response: `{"generated_at": "<iso timestamp>", "summary": "<text>"}`, or `null`/`404` if none
  has been generated yet.

## `POST /admin/summary/run` (proposed — not yet implemented)

Triggers generation of a new daily summary. Mirrors `/admin/retrain`'s existing shape (fire an
async job, return immediately) since it's the closest precedent already in `admin.py`.

- Header: `Authorization: Bearer <supabase access token>`.
- Body: `{"org_id": "<uuid>"}`.
- Response: `202` `{"status": "started"}`.

## Local dev

Mobile assumes `apps/api` is reachable at `http://<laptop LAN IP>:8001` in dev
(`EXPO_PUBLIC_API_URL`) — 8001 is still a guess (nothing in `apps/api` pins a port; 8000 is
Kong's, not this service's). If `apps/api` ends up on a different port, update
`apps/mobile/.env`/`.env.example` and this line, nothing else.
