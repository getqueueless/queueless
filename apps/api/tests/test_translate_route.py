"""HTTP layer for POST /translate: staff/admin only, degrades to the
original text (200, not 503) when AI is unconfigured -- unlike /admin/ask,
translation failing must never break the caller."""

import uuid

from tests.conftest import make_token


async def _seed_role(db_pool, user_id, role):
    await db_pool.execute(
        "INSERT INTO profiles (id, role) VALUES ($1, $2) "
        "ON CONFLICT (id) DO UPDATE SET role = excluded.role",
        user_id, role,
    )


async def test_patient_forbidden(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "patient")
    resp = client.post(
        "/translate",
        json={"text": "hello", "target_lang": "hi"},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 403


async def test_staff_allowed_falls_back_when_ai_unconfigured(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "staff")
    resp = client.post(
        "/translate",
        json={"text": "hello there", "target_lang": "hi"},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"translated": "hello there", "target_lang": "hi"}


async def test_unsupported_language_rejected_by_validation(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "staff")
    resp = client.post(
        "/translate",
        json={"text": "hello", "target_lang": "fr"},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 422
