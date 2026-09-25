import asyncio
import json
from uuid import UUID

import asyncpg
import structlog
from exponent_server_sdk import (
    DeviceNotRegisteredError,
    PushClient,
    PushMessage,
    PushTicketError,
)

from app.config import Settings
from app.db import get_direct_connection
from app.metrics import queue_depth
from app.translate import TranslateDeps, translate_text

log = structlog.get_logger()

# push_tokens (supabase/migrations/0016) is owned and written by the client
# (web/mobile via the Supabase SDK) under RLS policy push_tokens_owner --
# apps/api's `queueless_api` role only has SELECT/DELETE on it (migration
# 0018), so there is no registration write path here. apps/api only reads it
# to send pushes and deletes a row once Expo reports it as unregistered.

# apps/api is delivery-only: the DB decides who to notify and writes the row
# (private.tokens_after_write, supabase/migrations/0024; private.housekeeping,
# 0027) -- this module only turns an undelivered notifications row into an
# Expo push, exactly once. It used to also decide who was 3rd in line / who
# was just called, duplicating the DB trigger; that logic was removed.

_grant_missing_logged = False


async def send_push(pool: asyncpg.Pool, user_id: UUID, body: str, *, title: str = "") -> None:
    rows = await pool.fetch("SELECT expo_token FROM push_tokens WHERE user_id = $1", user_id)
    if not rows:
        return
    messages = [PushMessage(to=row["expo_token"], title=title or None, body=body) for row in rows]
    tickets = await asyncio.to_thread(PushClient().publish_multiple, messages)
    for ticket in tickets:
        try:
            ticket.validate_response()
        except DeviceNotRegisteredError:
            await pool.execute(
                "DELETE FROM push_tokens WHERE expo_token = $1", ticket.push_message.to
            )
        except PushTicketError as exc:
            log.warning("push_ticket_error", token=ticket.push_message.to, error=str(exc))


_language_column_missing_logged = False


async def _patient_language(pool: asyncpg.Pool, patient_id: UUID) -> str | None:
    """profiles.language doesn't exist in the real schema yet (as of this
    writing) -- same missing-column shape as notifications.pushed_at was
    before 0031 landed. Degrade to "no translation" rather than crash."""
    global _language_column_missing_logged
    try:
        return await pool.fetchval("SELECT language FROM profiles WHERE id = $1", patient_id)
    except asyncpg.exceptions.UndefinedColumnError as exc:
        if not _language_column_missing_logged:
            log.warning(
                "profiles_language_column_missing",
                note="ADD COLUMN language text to public.profiles for AI translation to activate",
                error=str(exc),
            )
            _language_column_missing_logged = True
        return None


async def deliver_notification(
    pool: asyncpg.Pool,
    notification_id: UUID,
    patient_id: UUID,
    body: str,
    *,
    title: str = "",
    translate_deps: TranslateDeps | None = None,
) -> bool:
    """Claims one notifications row and pushes it. The `WHERE pushed_at IS
    NULL` guard makes this atomic under Postgres's own row locking -- two
    replicas racing the same row can't both claim it, no advisory lock
    needed (unlike the old no-show tick, this claims one row at a time, not
    a whole batch)."""
    claimed = await pool.fetchval(
        "UPDATE notifications SET pushed_at = now() WHERE id = $1 AND pushed_at IS NULL RETURNING id",
        notification_id,
    )
    if claimed is None:
        return False

    if translate_deps is not None:
        language = await _patient_language(pool, patient_id)
        if language in ("hi", "pa"):
            if title:
                title = await translate_text(
                    translate_deps.client, translate_deps.model, translate_deps.max_tokens,
                    translate_deps.cache_size, title, language,
                )
            body = await translate_text(
                translate_deps.client, translate_deps.model, translate_deps.max_tokens,
                translate_deps.cache_size, body, language,
            )

    await send_push(pool, patient_id, body, title=title)
    return True


async def poll_tick(pool: asyncpg.Pool, *, translate_deps: TranslateDeps | None = None) -> None:
    """Delivery only. `public.notifications.pushed_at` and the SELECT/UPDATE
    grant on it for the `queueless_api` role are not in
    supabase/migrations/0018_queueless_api_role.sql as of this writing --
    apps/api cannot fix that itself (out of scope). Until the DB agent adds
    both, this logs once and no-ops every tick instead of crash-looping; it
    starts working the moment the grant/column land, no redeploy needed."""
    global _grant_missing_logged
    try:
        rows = await pool.fetch(
            "SELECT id, patient_id, title, body FROM notifications WHERE pushed_at IS NULL "
            "ORDER BY created_at LIMIT 100"
        )
    except (asyncpg.exceptions.UndefinedColumnError, asyncpg.exceptions.InsufficientPrivilegeError) as exc:
        if not _grant_missing_logged:
            log.warning(
                "notifications_delivery_pending_db_grant",
                note="queueless_api needs SELECT, UPDATE (pushed_at) ON public.notifications "
                "and an ADD COLUMN pushed_at timestamptz -- see supabase/migrations/0018",
                error=str(exc),
            )
            _grant_missing_logged = True
        return

    for row in rows:
        await deliver_notification(
            pool, row["id"], row["patient_id"], row["body"],
            title=row["title"], translate_deps=translate_deps,
        )

    waiting_counts = await pool.fetch(
        """
        SELECT s.name AS service, count(*) AS n
        FROM tokens t JOIN services s ON s.id = t.service_id
        WHERE t.status = 'waiting'
        GROUP BY s.name
        """
    )
    for row in waiting_counts:
        queue_depth.labels(service=row["service"]).set(row["n"])


async def _handle_notify_payload(
    pool: asyncpg.Pool, payload: str, *, translate_deps: TranslateDeps | None = None
) -> None:
    """Expected shape once a NOTIFY trigger lands on `public.notifications`
    inserts (none exists in supabase/migrations as of this writing):
    {"id": ..., "patient_id": ..., "title": ..., "body": ...} -- the row's
    own columns, since apps/api no longer decides kind/title/body, it only
    delivers."""
    try:
        data = json.loads(payload)
        notification_id = UUID(data["id"])
        patient_id = UUID(data["patient_id"])
        title = data.get("title", "")
        body = data["body"]
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.warning("notifications_payload_invalid", error=str(exc), payload=payload)
        return
    await deliver_notification(pool, notification_id, patient_id, body, title=title, translate_deps=translate_deps)


async def listen_task(
    settings: Settings, pool: asyncpg.Pool, *, translate_deps: TranslateDeps | None = None
) -> None:
    """Activates the moment the DB team lands a NOTIFY trigger on
    `public.notifications` inserts (none exists there yet). Until then this
    holds an idle, auto-reconnecting LISTEN connection; poller_task below is
    the path actually delivering notifications. deliver_notification's
    pushed_at guard makes it safe to run both concurrently once the trigger
    does exist."""
    log.info(
        "notifications_listener_starting",
        note="polling is the active delivery path until a NOTIFY trigger exists on origin/main",
    )
    conn: asyncpg.Connection | None = None
    backoff = 1.0
    while True:
        try:
            if conn is None or conn.is_closed():
                conn = await get_direct_connection(settings)
                await conn.add_listener(
                    "notifications_events",
                    lambda *args: asyncio.create_task(
                        _handle_notify_payload(pool, args[-1], translate_deps=translate_deps)
                    ),
                )
                backoff = 1.0
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            if conn is not None:
                await conn.close()
            raise
        except Exception as exc:  # noqa: BLE001 - reconnect loop must never die
            log.warning("notifications_listener_error", error=str(exc))
            conn = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def poller_task(
    pool: asyncpg.Pool, interval_seconds: int, *, translate_deps: TranslateDeps | None = None
) -> None:
    while True:
        try:
            await poll_tick(pool, translate_deps=translate_deps)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad tick must not kill the loop
            log.warning("poll_tick_error", error=str(exc))
        await asyncio.sleep(interval_seconds)
