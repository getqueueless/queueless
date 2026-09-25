import uuid
from datetime import datetime, timedelta, timezone

import pytest
from exponent_server_sdk import PushTicket

import app.notifications as notifications_module
from app.notifications import notify_if_new, poll_tick


@pytest.fixture(autouse=True)
def fake_expo(monkeypatch):
    def fake_publish_multiple(self, messages):
        return [PushTicket(m, "ok", None, None, None) for m in messages]

    monkeypatch.setattr(notifications_module.PushClient, "publish_multiple", fake_publish_multiple)


async def test_notify_if_new_fires_once_then_dedups(db_pool):
    token_id = uuid.uuid4()
    first = await notify_if_new(db_pool, token_id, "called")
    second = await notify_if_new(db_pool, token_id, "called")
    assert first is True
    assert second is False


async def test_poll_tick_notifies_third_in_line_and_called(db_pool):
    service = "general_opd"
    base = datetime.now(timezone.utc)
    ids = [uuid.uuid4() for _ in range(3)]
    user_ids = [uuid.uuid4() for _ in range(3)]
    for i, (tid, uid) in enumerate(zip(ids, user_ids)):
        await db_pool.execute(
            "INSERT INTO tokens(id, service, status, user_id, created_at) "
            "VALUES ($1, $2, 'waiting', $3, $4)",
            tid,
            service,
            uid,
            base + timedelta(seconds=i),
        )
        await db_pool.execute(
            "INSERT INTO push_tokens(user_id, device_id, token) VALUES ($1, 'd1', $2)",
            uid,
            f"ExponentPushToken[{i}]",
        )

    called_id = uuid.uuid4()
    called_user = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens(id, service, status, user_id, called_at) "
        "VALUES ($1, $2, 'called', $3, now())",
        called_id,
        service,
        called_user,
    )
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, device_id, token) VALUES ($1, 'd1', $2)",
        called_user,
        "ExponentPushToken[called]",
    )

    await poll_tick(db_pool)

    third = await db_pool.fetchrow(
        "SELECT 1 FROM token_notifications WHERE token_id = $1 AND kind = 'third_in_line'",
        ids[2],
    )
    assert third is not None

    second_position = await db_pool.fetchrow(
        "SELECT 1 FROM token_notifications WHERE token_id = $1 AND kind = 'third_in_line'",
        ids[1],
    )
    assert second_position is None

    called_notified = await db_pool.fetchrow(
        "SELECT 1 FROM token_notifications WHERE token_id = $1 AND kind = 'called'",
        called_id,
    )
    assert called_notified is not None

    await poll_tick(db_pool)
    total = await db_pool.fetchval("SELECT count(*) FROM token_notifications")
    assert total == 2
