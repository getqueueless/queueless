"""GET /admin/model -- admin-only, read-only report of the currently-loaded
model's metadata straight from app.state.ml_meta. No retraining, no DB
query, must be fast."""

import uuid

from tests.conftest import make_token


async def _seed_role(db_pool, user_id, role):
    await db_pool.execute(
        "INSERT INTO profiles (id, role) VALUES ($1, $2) "
        "ON CONFLICT (id) DO UPDATE SET role = excluded.role",
        user_id,
        role,
    )


async def test_patient_forbidden_from_admin_model(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "patient")
    token = make_token(sub=str(user_id))
    resp = client.get("/admin/model", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_staff_forbidden_from_admin_model(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "staff")
    token = make_token(sub=str(user_id))
    resp = client.get("/admin/model", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_no_auth_header_rejected(client):
    resp = client.get("/admin/model")
    assert resp.status_code == 401


async def test_admin_gets_model_metadata(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "admin")
    token = make_token(sub=str(user_id))
    resp = client.get("/admin/model", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    for key in (
        "version",
        "trained_at",
        "trained_on",
        "mae_model",
        "mae_baseline",
        "split_method",
        "n_rows",
        "mae_model_by_service",
    ):
        assert key in body, f"missing field: {key}"


async def test_patient_forbidden_from_admin_retrain(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "patient")
    token = make_token(sub=str(user_id))
    resp = client.post("/admin/retrain", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_staff_forbidden_from_admin_retrain(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "staff")
    token = make_token(sub=str(user_id))
    resp = client.post("/admin/retrain", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_admin_retrain_starts_and_returns_202(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "admin")
    token = make_token(sub=str(user_id))
    resp = client.post("/admin/retrain", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 202
    assert resp.json()["status"] == "started"
