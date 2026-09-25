import uuid

from tests.conftest import make_token

VALID_EXPO_TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"


def test_register_valid_token(client):
    token = make_token()
    resp = client.post(
        "/push-tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"token": VALID_EXPO_TOKEN, "device_id": "device-1"},
    )
    assert resp.status_code == 204


def test_register_rejects_non_expo_token(client):
    token = make_token()
    resp = client.post(
        "/push-tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"token": "not-a-push-token", "device_id": "device-1"},
    )
    assert resp.status_code == 422


def test_register_rejects_extra_field(client):
    token = make_token()
    resp = client.post(
        "/push-tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"token": VALID_EXPO_TOKEN, "device_id": "device-1", "role": "admin"},
    )
    assert resp.status_code == 422


def test_register_requires_auth(client):
    resp = client.post(
        "/push-tokens", json={"token": VALID_EXPO_TOKEN, "device_id": "device-1"}
    )
    assert resp.status_code == 401


async def test_reregistering_same_token_reassigns_owner(client, db_pool):
    first_user = make_token(sub=str(uuid.uuid4()))
    client.post(
        "/push-tokens",
        headers={"Authorization": f"Bearer {first_user}"},
        json={"token": VALID_EXPO_TOKEN, "device_id": "device-1"},
    )

    second_user_id = uuid.uuid4()
    second_user = make_token(sub=str(second_user_id))
    resp = client.post(
        "/push-tokens",
        headers={"Authorization": f"Bearer {second_user}"},
        json={"token": VALID_EXPO_TOKEN, "device_id": "device-1"},
    )
    assert resp.status_code == 204

    row = await db_pool.fetchrow(
        "SELECT user_id FROM push_tokens WHERE token = $1", VALID_EXPO_TOKEN
    )
    assert row["user_id"] == second_user_id
