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

## `POST /admin/ask` (live — `apps/api/app/routes/ai.py`)

This session originally proposed a different shape for this route before `apps/api` implemented
it; reconciled against the real source. `org_id` is **never** a request param — it's resolved
server-side from the caller's authenticated profile (`require_org_role("admin")`), and the
request body is pydantic `extra="forbid"`, so a stray `org_id` field 422s rather than being
ignored.

- Header: `Authorization: Bearer <supabase access token>`.
- Body: `{"question": "<1-500 chars>"}`.
- Response: `{"answer": "<text>", "ai_generated": true, "function": "<analytics fn name>" | null,
  "params": {...} | null, "rows": [...] | null}`, or `{"error": "<code>"}` with a matching
  non-2xx status (`503` for `ai_unavailable`, etc).
- `rows` is whatever the whitelisted `analytics.*` Postgres function returned — shape varies per
  function, mobile renders it generically (one line per row) rather than assuming columns.

## `GET /admin/summary` (live — `apps/api/app/routes/ai.py`)

Returns the stored daily summary for a day (defaults to today).

- Header: `Authorization: Bearer <supabase access token>` (also resolves `org_id`).
- Query: `?day=<YYYY-MM-DD>` (optional) `&lang=hi|pa` (optional, server-side translates `report`).
- Response: `{"org_id", "day", "report": "<text>", "ai_generated": bool, "aggregates": {...}}`,
  or `404` if none exists for that day yet. No timestamp field.

## `POST /admin/summary/run` (live — `apps/api/app/routes/ai.py`)

**Runs synchronously** — a real DeepSeek call plus a DB write, not a fire-and-forget job. The
response body is the finished summary, same shape as the `GET` above.

- Header: `Authorization: Bearer <supabase access token>`.
- Body: `{"day": "<YYYY-MM-DD>" | null}` (optional, defaults to today).
- Response: `{"org_id", "day", "report", "ai_generated", "aggregates"}` — `ai_generated` is
  `false` when DeepSeek was unavailable (a plain-aggregates fallback report is still written).

## `POST /translate` (live — `apps/api/app/routes/ai.py`, not yet called by mobile)

Staff/admin-only, DeepSeek-backed. `{"text": "<1-1000 chars>", "target_lang": "hi" | "pa"}` →
`{"translated": "<text>", "target_lang": "hi" | "pa"}`. Not wired into any mobile screen yet —
`profiles.language`/`set_my_language` (migration `0035`) let a patient set a language preference,
but full-app translation via this endpoint is a larger follow-up, not built in this pass.

## Realtime topics (DB-side broadcast, not `apps/api`)

`postgres_changes` never fires for anyone on this stack: the self-hosted `supabase_realtime`
publication has zero member tables (nothing ever added one), so subscribing to `tokens`,
`board_services`, or `board_counters` directly silently receives nothing — this is why `/t/<id>`
(opened from a slip QR) and the TV display board don't update live. Fixing the publication alone
still wouldn't work for an anonymous viewer: `postgres_changes` needs a per-row RLS check against
the subscriber's role, and `public.tokens` carries columns (`patient_id`, `walkin_patient_id`)
that must never reach an unauthenticated client.

Fix (migration `0044`): `private.tokens_after_write` — the trigger that already runs after every
`insert`/`update` on `public.tokens` — calls Realtime's Broadcast-from-Database function,
`realtime.send()`, with `private = false`, to two topics per write:

- `service:<service_id>` — anyone watching the whole queue for a service (the display board).
- `token:<token_id>` — the single patient on `/t/<id>`, watching their own ticket.

Both topics get the same event name and payload:

- Event: `token_update`
- Payload (exactly these 5 fields, plus `id`, which Realtime auto-injects into every broadcast
  payload that doesn't already have one — that `id` is the message id, not the token id):
  ```json
  {
    "token_id": "<tokens.id>",
    "number": "<tokens.number>",
    "status": "<tokens.status>",
    "counter_id": "<tokens.counter_id, or null>",
    "updated_at": "<timestamptz of this broadcast, not a tokens column>"
  }
  ```
- Deliberately excluded: patient name, phone, any user id, the token's own `code`, lane/priority.
  A subscriber that needs a counter's display name already has to look it up separately (same as
  today's initial page load) — `counter_id` is enough to trigger that lookup.

Subscribe on the anon (or any) Supabase client with:

```ts
supabase.channel(`token:${tokenId}`)
  .on("broadcast", { event: "token_update" }, ({ payload }) => { /* ... */ })
  .subscribe()
```

No RLS or table grant is needed to receive these — `private = false` makes the topic public by
design, since the payload has nothing worth protecting.

**Still on `postgres_changes` today, unaffected by this fix:** `apps/web`'s display board
(`board_services`/`board_counters`) and the landing page's live stats. Those tables are public-read
already (0030), so once/if they're added to the `supabase_realtime` publication, `postgres_changes`
would work for them without a broadcast rewrite — that's a smaller follow-up than tokens was,
since there's no PII to strip. Not done here; flagging it so **Hackathon frontend** knows the gap
still exists on the board's own realtime path if they don't switch those two listeners over to
`service:<service_id>` and re-fetch on receipt.

**Consumers to update** (this migration only changes the DB): **Hackathon frontend**
(`apps/web/src/lib/realtime/useResilientChannel.ts` and its 4 call sites currently pass
`table: "tokens"` — none of them will receive anything until they switch to `.channel(topic).on("broadcast", ...)`
against the topics above), **Hackathon mobile app**, and **Mobile patients feature**.

## Local dev

Mobile assumes `apps/api` is reachable at `http://<laptop LAN IP>:8001` in dev
(`EXPO_PUBLIC_API_URL`) — 8001 is still a guess (nothing in `apps/api` pins a port; 8000 is
Kong's, not this service's). If `apps/api` ends up on a different port, update
`apps/mobile/.env`/`.env.example` and this line, nothing else.
