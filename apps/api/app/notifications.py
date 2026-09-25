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


async def record_and_push(
    pool: asyncpg.Pool, patient_id: UUID, token_id: UUID, kind: str, title: str, body: str
) -> bool:
    """Writes to the DB team's real `notifications` table (supabase/migrations/
    0006), not a separate apps/api-owned dedup table -- its own
    `unique (token_id, kind)` constraint is the same atomic dedup primitive a
    parallel table would give us, and writing here means the row also shows
    up in the mobile app's own in-app notification history/Realtime feed."""
    row = await pool.fetchrow(
        """
        INSERT INTO notifications (patient_id, token_id, kind, title, body)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (token_id, kind) DO NOTHING
        RETURNING id
        """,
        patient_id,
        token_id,
        kind,
        title,
        body,
    )
    if row is None:
        return False
    await send_push(pool, patient_id, body)
    return True


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
    why this exists instead of relying solely on LISTEN/NOTIFY. Queue order
    and "position" mirror the real ordering used by public.my_queue_status
    (supabase/migrations/0012): partition by (service_id, service_day), order
    by (lane_rank, priority_at, number)."""
    almost_turn = await pool.fetch(
        """
        SELECT r.id, r.patient_id, s.name AS service_name FROM (
            SELECT t.id, t.patient_id, t.service_id,
                   row_number() OVER (
                       PARTITION BY t.service_id, t.service_day
                       ORDER BY t.lane_rank, t.priority_at, t.number
                   ) AS position
            FROM tokens t
            WHERE t.status = 'waiting'
        ) r
        JOIN services s ON s.id = r.service_id
        WHERE r.position = 3
        """
    )
    for row in almost_turn:
        await record_and_push(
            pool,
            row["patient_id"],
            row["id"],
            "almost_turn",
            "Almost your turn",
            f"You're 3rd in line for {row['service_name']}",
        )

    just_called = await pool.fetch(
        """
        SELECT t.id, t.patient_id, s.name AS service_name
        FROM tokens t
        JOIN services s ON s.id = t.service_id
        WHERE t.status = 'called'
          AND NOT EXISTS (
              SELECT 1 FROM notifications n
              WHERE n.token_id = t.id AND n.kind = 'called'
          )
        """
    )
    for row in just_called:
        await record_and_push(
            pool,
            row["patient_id"],
            row["id"],
            "called",
            "You've been called",
            f"You've been called for {row['service_name']}",
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


async def _handle_notify_payload(pool: asyncpg.Pool, payload: str) -> None:
    """Expected shape once a pg_notify('token_events', ...) trigger lands
    (still absent from supabase/migrations as of this writing): {"token_id":
    ..., "patient_id": ..., "kind": "almost_turn"|"called", "service_name":
    ...}. kind must be a value the real notifications.kind check constraint
    allows (supabase/migrations/0006)."""
    try:
        data = json.loads(payload)
        token_id = UUID(data["token_id"])
        patient_id = UUID(data["patient_id"])
        kind = data["kind"]
        service_name = data.get("service_name", "")
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.warning("token_events_payload_invalid", error=str(exc), payload=payload)
        return
    title = "Almost your turn" if kind == "almost_turn" else "You've been called"
    body = (
        f"You're 3rd in line for {service_name}"
        if kind == "almost_turn"
        else f"You've been called for {service_name}"
    )
    await record_and_push(pool, patient_id, token_id, kind, title, body)


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
