"""HTTP layer for POST /admin/ask: role/org enforcement, and 503 (never
500) when DeepSeek is unavailable or fails."""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

from tests.conftest import make_token


async def _seed_profile(db_pool, user_id, role, org_id=None):
    await db_pool.execute(
        "INSERT INTO profiles (id, role, org_id) VALUES ($1, $2, $3) "
        "ON CONFLICT (id) DO UPDATE SET role = excluded.role, org_id = excluded.org_id",
        user_id, role, org_id or uuid.uuid4(),
    )


async def test_patient_forbidden(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "patient")
    resp = client.post(
        "/admin/ask",
        json={"question": "how many no-shows today?"},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 403


async def test_staff_forbidden(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "staff")
    resp = client.post(
        "/admin/ask",
        json={"question": "how many no-shows today?"},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 403


async def test_no_auth_header_401(client):
    resp = client.post("/admin/ask", json={"question": "x"})
    assert resp.status_code == 401


async def test_admin_gets_503_when_ai_unconfigured(client, db_pool):
    # conftest.py never sets DEEPSEEK_API_KEY -- app.state.deepseek_client
    # is genuinely None here, this isn't a monkeypatch.
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "admin")
    resp = client.post(
        "/admin/ask",
        json={"question": "how many no-shows today?"},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 503


async def test_extra_field_rejected(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "admin")
    resp = client.post(
        "/admin/ask",
        json={"question": "x", "org_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )
    assert resp.status_code == 422


async def test_admin_happy_path_with_injected_fake_client(client, db_pool):
    from app.main import app as real_app

    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "admin", org_id)

    def _tool_response():
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=None,
                        tool_calls=[
                            SimpleNamespace(
                                id="call_1",
                                function=SimpleNamespace(
                                    name="no_shows_by_service",
                                    arguments=json.dumps({"day": "2026-01-01"}),
                                ),
                            )
                        ],
                    )
                )
            ]
        )

    def _text_response():
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="No no-shows.", tool_calls=None))])

    fake_client = SimpleNamespace()
    fake_client.chat = SimpleNamespace()
    fake_client.chat.completions = SimpleNamespace()
    fake_client.chat.completions.create = AsyncMock(side_effect=[_tool_response(), _text_response()])

    original = real_app.state.deepseek_client
    real_app.state.deepseek_client = fake_client
    try:
        resp = client.post(
            "/admin/ask",
            json={"question": "how many no-shows on 2026-01-01?"},
            headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
        )
    finally:
        real_app.state.deepseek_client = original

    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_generated"] is True
    assert body["function"] == "no_shows_by_service"
    assert body["answer"] == "No no-shows."
