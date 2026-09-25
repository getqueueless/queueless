import asyncio
import json
from typing import Annotated
from uuid import UUID

import asyncpg
import structlog
from exponent_server_sdk import (
    DeviceNotRegisteredError,
    PushClient,
    PushMessage,
    PushTicketError,
)
from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.config import Settings
from app.db import get_direct_connection
from app.metrics import queue_depth

log = structlog.get_logger()

DeviceId = Annotated[str, StringConstraints(min_length=1, max_length=120, pattern=r"^[\w-]+$")]


class PushTokenIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    token: str
    device_id: DeviceId

    @field_validator("token")
    @classmethod
    def token_must_be_exponent(cls, value: str) -> str:
        if not PushClient.is_exponent_push_token(value):
            raise ValueError("not a valid Expo push token")
        return value


async def upsert_push_token(pool: asyncpg.Pool, user_id: UUID, device_id: str, token: str) -> None:
    # The same physical token can be re-registered by a different user after
    # a reinstall, so the token itself -- not (user_id, device_id) -- is the key.
    await pool.execute(
        """
        INSERT INTO push_tokens (user_id, device_id, token)
        VALUES ($1, $2, $3)
        ON CONFLICT (token) DO UPDATE
        SET user_id = EXCLUDED.user_id, device_id = EXCLUDED.device_id
        """,
        user_id,
        device_id,
        token,
    )


async def notify_if_new(pool: asyncpg.Pool, token_id: UUID, kind: str) -> bool:
    row = await pool.fetchrow(
        """
        INSERT INTO token_notifications (token_id, kind)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING 1
        """,
        token_id,
        kind,
    )
    return row is not None


async def send_push(pool: asyncpg.Pool, user_id: UUID, body: str) -> None:
    rows = await pool.fetch("SELECT token FROM push_tokens WHERE user_id = $1", user_id)
    if not rows:
        return
    messages = [PushMessage(to=row["token"], body=body) for row in rows]
    tickets = await asyncio.to_thread(PushClient().publish_multiple, messages)
    for ticket in tickets:
        try:
            ticket.validate_response()
        except DeviceNotRegisteredError:
            await pool.execute(
                "DELETE FROM push_tokens WHERE token = $1", ticket.push_message.to
            )
        except PushTicketError as exc:
            log.warning("push_ticket_error", token=ticket.push_message.to, error=str(exc))


async def poll_tick(pool: asyncpg.Pool) -> None:
    """The real, working notification path today -- see listen_task below for
    why this exists instead of relying solely on LISTEN/NOTIFY."""
    third_in_line = await pool.fetch(
        """
        SELECT id, user_id, service FROM (
            SELECT id, user_id, service,
                   row_number() OVER (PARTITION BY service ORDER BY created_at) AS position
            FROM tokens
            WHERE status = 'waiting'
        ) ranked
        WHERE position = 3
        """
    )
    for row in third_in_line:
        if await notify_if_new(pool, row["id"], "third_in_line"):
            await send_push(pool, row["user_id"], f"You're 3rd in line for {row['service']}")

    just_called = await pool.fetch(
        """
        SELECT t.id, t.user_id, t.service FROM tokens t
        WHERE t.status = 'called'
          AND NOT EXISTS (
              SELECT 1 FROM token_notifications n
              WHERE n.token_id = t.id AND n.kind = 'called'
          )
        """
    )
    for row in just_called:
        if await notify_if_new(pool, row["id"], "called"):
            await send_push(pool, row["user_id"], f"You've been called for {row['service']}")

    waiting_counts = await pool.fetch(
        "SELECT service, count(*) AS n FROM tokens WHERE status = 'waiting' GROUP BY service"
    )
    for row in waiting_counts:
        queue_depth.labels(service=row["service"]).set(row["n"])


async def _handle_notify_payload(pool: asyncpg.Pool, payload: str) -> None:
    try:
        data = json.loads(payload)
        token_id = UUID(data["token_id"])
        user_id = UUID(data["user_id"])
        kind = data["kind"]
        service = data.get("service", "")
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.warning("token_events_payload_invalid", error=str(exc), payload=payload)
        return
    if await notify_if_new(pool, token_id, kind):
        body = (
            f"You're 3rd in line for {service}"
            if kind == "third_in_line"
            else f"You've been called for {service}"
        )
        await send_push(pool, user_id, body)


async def listen_task(settings: Settings, pool: asyncpg.Pool) -> None:
    """Activates the moment the DB team lands a pg_notify('token_events', ...)
    trigger in supabase/migrations (none exists there yet). Until then this
    holds an idle, auto-reconnecting LISTEN connection; poller_task below is
    the path actually delivering notifications. notify_if_new's dedup table
    makes it safe to run both concurrently once the trigger does exist."""
    log.info(
        "token_events_listener_starting",
        note="polling fallback is the active path until a NOTIFY trigger exists on origin/main",
    )
    conn: asyncpg.Connection | None = None
    backoff = 1.0
    while True:
        try:
            if conn is None or conn.is_closed():
                conn = await get_direct_connection(settings)
                await conn.add_listener(
                    "token_events",
                    lambda *args: asyncio.create_task(_handle_notify_payload(pool, args[-1])),
                )
                backoff = 1.0
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            if conn is not None:
                await conn.close()
            raise
        except Exception as exc:  # noqa: BLE001 - reconnect loop must never die
            log.warning("token_events_listener_error", error=str(exc))
            conn = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def poller_task(pool: asyncpg.Pool, interval_seconds: int) -> None:
    while True:
        try:
            await poll_tick(pool)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad tick must not kill the loop
            log.warning("poll_tick_error", error=str(exc))
        await asyncio.sleep(interval_seconds)
