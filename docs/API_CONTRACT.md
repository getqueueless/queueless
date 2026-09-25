# API contract — mobile ⇄ apps/api

Written by the mobile session because neither `apps/api/README.md` nor this file existed yet on
`origin/main` when mobile needed it (`apps/api`'s own plan at `docs/api/plan-2026-09-25.md` has a
`/push-tokens` and `/predict` shape sketched for later tasks, but neither route is implemented yet).
This is a proposal for the API session to build to, or to override — if the shipped routes differ,
that difference is the source of truth and this file should be updated to match, not the other way
around.

Both endpoints are **optional at runtime** for the mobile app: a missing, slow, or erroring API
never blocks a screen. The queue and position (§3.2 estimate path, §3.6 local-notification path)
always come from Supabase directly; these two endpoints are pure enhancements layered on top.

## `POST /push/register`

Registers an Expo push token for the signed-in user.

- Header: `Authorization: Bearer <supabase access token>` — the API verifies it with the Supabase
  JWT secret to get the user id. The client never sends a `user_id` field.
- Body: `{"expo_push_token": "ExponentPushToken[...]"}`
- Response: `200` on success. Any non-2xx is treated as non-fatal by the client.

## `GET /predict?service_id=<uuid>`

Returns a predicted wait for one service.

- No auth required (public, patient-facing estimate).
- Response: `{"wait_seconds": <int>}`
- Any non-2xx, timeout, or malformed body → the client falls back to computing an estimate directly
  from `board_services` (`waiting_count * avg_service_secs / max(open_counters, 1)`), labeled
  "estimate" instead of "predicted".

## Local dev

Mobile assumes `apps/api` is reachable at `http://<laptop LAN IP>:8001` in dev (`EXPO_PUBLIC_API_URL`)
— 8001 is a guess (nothing in `apps/api/pyproject.toml` or `.env.example` pins a port; 8000 is
Kong's, not this service's). If `apps/api` ends up on a different port, update
`apps/mobile/.env`/`.env.example` and this line, nothing else.
