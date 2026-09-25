import uuid
from datetime import datetime, timedelta, timezone

import pytest
from exponent_server_sdk import PushTicket

import app.notifications as notifications_module
from app.notifications import poll_tick, record_and_push


@pytest.fixture(autouse=True)
def fake_expo(monkeypatch):
    def fake_publish_multiple(self, messages):
        return [PushTicket(m, "ok", None, None, None) for m in messages]

    monkeypatch.setattr(notifications_module.PushClient, "publish_multiple", fake_publish_multiple)


async def _seed_service(db_pool, name="General OPD") -> uuid.UUID:
    service_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO services(id, name) VALUES ($1, $2)", service_id, name
    )
    return service_id


async def test_record_and_push_fires_once_then_dedups(db_pool):
    token_id = uuid.uuid4()
    patient_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens(id, service_id, status, patient_id) VALUES ($1, $2, 'called', $3)",
        token_id,
        uuid.uuid4(),
        patient_id,
    )
    first = await record_and_push(db_pool, patient_id, token_id, "called", "t", "b")
    second = await record_and_push(db_pool, patient_id, token_id, "called", "t", "b")
    assert first is True
    assert second is False


async def test_poll_tick_notifies_almost_turn_and_called(db_pool):
    service_id = await _seed_service(db_pool)
    base = datetime.now(timezone.utc)
    ids = [uuid.uuid4() for _ in range(3)]
    patient_ids = [uuid.uuid4() for _ in range(3)]
    for i, (tid, pid) in enumerate(zip(ids, patient_ids)):
        await db_pool.execute(
            "INSERT INTO tokens(id, service_id, status, patient_id, number, priority_at) "
            "VALUES ($1, $2, 'waiting', $3, $4, $5)",
            tid,
            service_id,
            pid,
            i,
            base + timedelta(seconds=i),
        )
        await db_pool.execute(
            "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, 'ios')",
            pid,
            f"ExponentPushToken[{i}]",
        )

    called_id = uuid.uuid4()
    called_patient = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens(id, service_id, status, patient_id, called_at) "
        "VALUES ($1, $2, 'called', $3, now())",
        called_id,
        service_id,
        called_patient,
    )
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, 'ios')",
        called_patient,
        "ExponentPushToken[called]",
    )

    await poll_tick(db_pool)

    almost_turn = await db_pool.fetchrow(
        "SELECT 1 FROM notifications WHERE token_id = $1 AND kind = 'almost_turn'",
        ids[2],
    )
    assert almost_turn is not None

    second_position = await db_pool.fetchrow(
        "SELECT 1 FROM notifications WHERE token_id = $1 AND kind = 'almost_turn'",
        ids[1],
    )
    assert second_position is None

    called_notified = await db_pool.fetchrow(
        "SELECT 1 FROM notifications WHERE token_id = $1 AND kind = 'called'",
        called_id,
    )
    assert called_notified is not None

    await poll_tick(db_pool)
    total = await db_pool.fetchval("SELECT count(*) FROM notifications")
    assert total == 2
