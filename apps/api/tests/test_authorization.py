import uuid

from tests.conftest import make_token


async def _seed_role(db_pool, user_id, role):
    await db_pool.execute("INSERT INTO profiles(id, role) VALUES ($1, $2)", user_id, role)


async def _seed_org_role(db_pool, user_id, role, org_id):
    await db_pool.execute(
        "INSERT INTO profiles(id, role, org_id) VALUES ($1, $2, $3)", user_id, role, org_id
    )


async def test_patient_role_blocked_from_staff_route(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "patient")
    token = make_token(sub=str(user_id))
    resp = client.get("/_test/staff-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_staff_role_allowed(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "staff")
    token = make_token(sub=str(user_id))
    resp = client.get("/_test/staff-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


async def test_no_profile_row_blocked(client):
    token = make_token(sub=str(uuid.uuid4()))
    resp = client.get("/_test/staff-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_client_supplied_role_claim_ignored(client, db_pool):
    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "patient")
    token = make_token(sub=str(user_id), role="admin")
    resp = client.get(
        "/_test/staff-only",
        headers={"Authorization": f"Bearer {token}", "X-User-Role": "admin"},
    )
    assert resp.status_code == 403


async def test_role_cache_expires_and_reflects_revocation(client, db_pool, monkeypatch):
    import app.auth as auth_module

    user_id = uuid.uuid4()
    await _seed_role(db_pool, user_id, "staff")
    token = make_token(sub=str(user_id))

    ok = client.get("/_test/staff-only", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200

    await db_pool.execute("UPDATE profiles SET role = 'patient' WHERE id = $1", user_id)

    still_cached = client.get("/_test/staff-only", headers={"Authorization": f"Bearer {token}"})
    assert still_cached.status_code == 200

    real_time = auth_module.time.monotonic
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: real_time() + 3600)

    revoked = client.get("/_test/staff-only", headers={"Authorization": f"Bearer {token}"})
    assert revoked.status_code == 403


async def test_org_scoped_route_returns_callers_own_org(client, db_pool):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    await _seed_org_role(db_pool, user_id, "staff", org_id)
    token = make_token(sub=str(user_id))
    resp = client.get("/_test/org-scoped", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["org_id"] == str(org_id)


async def test_org_scoped_route_ignores_client_supplied_org(client, db_pool):
    real_org = uuid.uuid4()
    other_org = uuid.uuid4()
    user_id = uuid.uuid4()
    await _seed_org_role(db_pool, user_id, "staff", real_org)
    token = make_token(sub=str(user_id))
    resp = client.get(
        "/_test/org-scoped",
        headers={"Authorization": f"Bearer {token}", "X-Org-Id": str(other_org)},
    )
    assert resp.status_code == 200
    assert resp.json()["org_id"] == str(real_org)
    assert resp.json()["org_id"] != str(other_org)
