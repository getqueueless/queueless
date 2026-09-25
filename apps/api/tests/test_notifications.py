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


async def _seed_notification(db_pool, patient_id=None, body="hello", title="t", pushed=False):
    patient_id = patient_id or uuid.uuid4()
    notification_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO notifications(id, patient_id, kind, title, body) VALUES ($1, $2, 'called', $3, $4)",
        notification_id,
        patient_id,
        title,
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


async def test_deliver_notification_translates_when_patient_language_hi(db_pool, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.translate import TranslateDeps

    notification_id, patient_id = await _seed_notification(db_pool, body="You are being called", title="Called")
    await db_pool.execute(
        "INSERT INTO profiles (id, role, language) VALUES ($1, 'patient', 'hi') "
        "ON CONFLICT (id) DO UPDATE SET language = 'hi'",
        patient_id,
    )

    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="आपको बुलाया जा रहा है"))])
    fake_client = SimpleNamespace()
    fake_client.chat = SimpleNamespace()
    fake_client.chat.completions = SimpleNamespace()
    fake_client.chat.completions.create = AsyncMock(return_value=response)
    deps = TranslateDeps(client=fake_client, model="deepseek-chat", max_tokens=100, cache_size=8)

    sent_bodies = []

    def fake_publish_multiple(self, messages):
        sent_bodies.extend(m.body for m in messages)
        return [PushTicket(m, "ok", None, None, None) for m in messages]

    notifications_module.PushClient.publish_multiple = fake_publish_multiple
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, 'ios')",
        patient_id, "ExponentPushToken[hi-test]",
    )

    await deliver_notification(db_pool, notification_id, patient_id, "You are being called", title="Called", translate_deps=deps)

    assert sent_bodies == ["आपको बुलाया जा रहा है"]


async def test_deliver_notification_no_translation_when_language_missing_column(db_pool):
    """profiles.language doesn't exist in the real schema yet -- must
    degrade to English, never crash, exactly like the pushed_at grant gap."""
    notification_id, patient_id = await _seed_notification(db_pool, body="plain english")
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, 'ios')",
        patient_id, "ExponentPushToken[no-lang]",
    )

    class NoLanguagePool:
        def __init__(self, real_pool):
            self._real = real_pool

        async def fetchval(self, query, *args):
            if "language" in query:
                raise asyncpg.exceptions.UndefinedColumnError("column profiles.language does not exist")
            return await self._real.fetchval(query, *args)

        def __getattr__(self, name):
            return getattr(self._real, name)

    from app.translate import TranslateDeps
    deps = TranslateDeps(client=object(), model="deepseek-chat", max_tokens=100, cache_size=8)

    result = await deliver_notification(
        NoLanguagePool(db_pool), notification_id, patient_id, "plain english",
        title="Title", translate_deps=deps,
    )
    assert result is True


async def test_poll_tick_increments_tokens_issued_metric_since_last_tick(db_pool):
    import uuid

    import app.notifications as notifications_module
    from app.metrics import tokens_issued_total

    notifications_module._tokens_checkpoint = None
    service_id = uuid.uuid4()

    # First tick: only establishes the checkpoint, must not count anything
    # that existed before apps/api started watching (avoids a startup spike).
    await notifications_module.poll_tick(db_pool)
    before = tokens_issued_total.labels(service=str(service_id))._value.get()

    await db_pool.execute(
        "INSERT INTO tokens (id, service_id, status, created_at) VALUES ($1, $2, 'waiting', now())",
        uuid.uuid4(), service_id,
    )

    await notifications_module.poll_tick(db_pool)
    after = tokens_issued_total.labels(service=str(service_id))._value.get()
    assert after == before + 1
