"""push_tokens (supabase/migrations/0016) is owned by the client (web/mobile
via the Supabase SDK, RLS policy push_tokens_owner) -- apps/api has no
registration endpoint, only SELECT/DELETE (migration 0018). These tests seed
rows directly, as the client would have, and exercise apps/api's read/delete
path (app.notifications.send_push)."""

import uuid

from exponent_server_sdk import PushTicket

import app.notifications as notifications_module
from app.notifications import send_push


async def _seed_push_token(db_pool, user_id, expo_token, platform="ios"):
    await db_pool.execute(
        "INSERT INTO push_tokens(user_id, expo_token, platform) VALUES ($1, $2, $3)",
        user_id,
        expo_token,
        platform,
    )


async def test_send_push_reads_real_expo_token_column(db_pool, monkeypatch):
    sent_to = []

    def fake_publish_multiple(self, messages):
        sent_to.extend(m.to for m in messages)
        return [PushTicket(m, "ok", None, None, None) for m in messages]

    monkeypatch.setattr(notifications_module.PushClient, "publish_multiple", fake_publish_multiple)

    user_id = uuid.uuid4()
    await _seed_push_token(db_pool, user_id, "ExponentPushToken[aaa]")

    await send_push(db_pool, user_id, "hello")

    assert sent_to == ["ExponentPushToken[aaa]"]


async def test_send_push_with_no_tokens_is_a_noop(db_pool, monkeypatch):
    def fake_publish_multiple(self, messages):
        raise AssertionError("should never be called with zero tokens")

    monkeypatch.setattr(notifications_module.PushClient, "publish_multiple", fake_publish_multiple)

    await send_push(db_pool, uuid.uuid4(), "hello")


async def test_send_push_deletes_stale_token_by_expo_token(db_pool, monkeypatch):
    def fake_publish_multiple(self, messages):
        return [
            PushTicket(m, "error", None, {"error": "DeviceNotRegistered"}, None)
            for m in messages
        ]

    monkeypatch.setattr(notifications_module.PushClient, "publish_multiple", fake_publish_multiple)

    user_id = uuid.uuid4()
    stale_token = "ExponentPushToken[stale]"
    await _seed_push_token(db_pool, user_id, stale_token)

    await send_push(db_pool, user_id, "hello")

    row = await db_pool.fetchrow(
        "SELECT 1 FROM push_tokens WHERE expo_token = $1", stale_token
    )
    assert row is None


async def test_registration_endpoint_no_longer_exists(client):
    resp = client.post(
        "/push-tokens", json={"token": "ExponentPushToken[x]", "device_id": "d1"}
    )
    assert resp.status_code == 404
