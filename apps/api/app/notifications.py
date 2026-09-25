import asyncio
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
