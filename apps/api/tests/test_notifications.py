import asyncio
import uuid

import asyncpg
import pytest
from exponent_server_sdk import PushTicket

import app.notifications as notifications_module
from app.notifications import deliver_notification, poll_tick


@pytest.fixture(autouse=True)
def fake_expo(monkeypatch):
    def fake_publish_multiple(self, messages):
        return [PushTicket(m, "ok", None, None, None) for m in messages]

    monkeypatch.setattr(notifications_module.PushClient, "publish_multiple", fake_publish_multiple)


async def _seed_notification(db_pool, patient_id=None, body="hello", pushed=False):
    patient_id = patient_id or uuid.uuid4()
    notification_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO notifications(id, patient_id, kind, title, body) VALUES ($1, $2, 'called', 't', $3)",
        notification_id,
        patient_id,
        body,
    )
    if pushed:
        await db_pool.execute(
            "UPDATE notifications SET pushed_at = now() WHERE id = $1", notification_id
        )
    return notification_id, patient_id


async def test_deliver_notification_claims_exactly_once(db_pool):
    notification_id, patient_id = await _seed_notification(db_pool)

    first = await deliver_notification(db_pool, notification_id, patient_id, "hello")
    second = await deliver_notification(db_pool, notification_id, patient_id, "hello")

    assert first is True
    assert second is False
    row = await db_pool.fetchrow(
        "SELECT pushed_at FROM notifications WHERE id = $1", notification_id
    )
    assert row["pushed_at"] is not None


async def test_two_concurrent_claims_on_same_row_exactly_one_wins(db_pool):
    notification_id, patient_id = await _seed_notification(db_pool)

    results = await asyncio.gather(
        deliver_notification(db_pool, notification_id, patient_id, "hello"),
        deliver_notification(db_pool, notification_id, patient_id, "hello"),
    )

    assert sorted(results) == [False, True]


async def test_deliver_notification_sends_push_to_patients_tokens(db_pool):
    notification_id, patient_id = await _seed_notification(db_pool, body="you're up")
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, 'ios')",
        patient_id,
        "ExponentPushToken[aaa]",
    )
    sent = []

    def fake_publish_multiple(self, messages):
        sent.extend(m.to for m in messages)
        return [PushTicket(m, "ok", None, None, None) for m in messages]

    notifications_module.PushClient.publish_multiple = fake_publish_multiple

    await deliver_notification(db_pool, notification_id, patient_id, "you're up")

    assert sent == ["ExponentPushToken[aaa]"]


async def test_poll_tick_delivers_only_unpushed_rows(db_pool):
    unpushed_id, patient_id = await _seed_notification(db_pool, body="deliver me")
    pushed_id, _ = await _seed_notification(db_pool, body="already sent", pushed=True)
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, 'ios')",
        patient_id,
        "ExponentPushToken[bbb]",
    )
    pushed_row_before = await db_pool.fetchrow(
        "SELECT pushed_at FROM notifications WHERE id = $1", pushed_id
    )

    await poll_tick(db_pool)

    unpushed_row = await db_pool.fetchrow(
        "SELECT pushed_at FROM notifications WHERE id = $1", unpushed_id
    )
    assert unpushed_row["pushed_at"] is not None

    pushed_row_after = await db_pool.fetchrow(
        "SELECT pushed_at FROM notifications WHERE id = $1", pushed_id
    )
    assert pushed_row_after["pushed_at"] == pushed_row_before["pushed_at"]


async def test_poll_tick_logs_once_and_does_not_raise_when_column_missing():
    class FakePool:
        async def fetch(self, *args, **kwargs):
            raise asyncpg.exceptions.UndefinedColumnError("column pushed_at does not exist")

    notifications_module._grant_missing_logged = False
    # Must not raise -- this is the "don't crash-loop while waiting on the
    # DB grant/column" behavior the DB agent hasn't shipped yet.
    await poll_tick(FakePool())
    assert notifications_module._grant_missing_logged is True
