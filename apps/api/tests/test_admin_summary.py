"""HTTP layer for POST /admin/summary/run and GET /admin/summary: admin
only, org-scoped, DeepSeek mocked at app.state for the happy path."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

from tests.conftest import make_token


async def _seed_profile(db_pool, user_id, role, org_id=None):
    org_id = org_id or uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO profiles (id, role, org_id) VALUES ($1, $2, $3) "
        "ON CONFLICT (id) DO UPDATE SET role = excluded.role, org_id = excluded.org_id",
        user_id, role, org_id,
    )
    return org_id


async def test_patient_forbidden_run(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "patient")
    resp = client.post(
        "/admin/summary/run", json={},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 403


async def test_patient_forbidden_get(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "patient")
    resp = client.get(
        "/admin/summary", headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"}
    )
    assert resp.status_code == 403


async def test_get_returns_404_when_no_summary_yet(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "admin")
    resp = client.get(
        "/admin/summary", headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"}
    )
    assert resp.status_code == 404


async def test_run_then_get_round_trip(client, db_pool):
    from app.main import app as real_app

    user_id = uuid.uuid4()
    org_id = await _seed_profile(db_pool, user_id, "admin")

    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Quiet day overall."))])
    fake_client = SimpleNamespace()
    fake_client.chat = SimpleNamespace()
    fake_client.chat.completions = SimpleNamespace()
    fake_client.chat.completions.create = AsyncMock(return_value=response)

    original = real_app.state.deepseek_client
    real_app.state.deepseek_client = fake_client
    try:
        headers = {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}
        run_resp = client.post("/admin/summary/run", json={}, headers=headers)
        assert run_resp.status_code == 200
        assert run_resp.json()["ai_generated"] is True

        get_resp = client.get("/admin/summary", headers=headers)
        assert get_resp.status_code == 200
        body = get_resp.json()
        assert body["org_id"] == str(org_id)
        assert body["report"] == "Quiet day overall."
        assert "aggregates" in body
    finally:
        real_app.state.deepseek_client = original
