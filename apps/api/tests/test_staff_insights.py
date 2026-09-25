"""GET /staff/insights -- staff or admin, org-scoped. Per-counter served/
no-show/avg-service-time for today, plus current wait by service, filtered
to the caller's own org_id (looked up server-side, never client-supplied)."""

import uuid
from datetime import date, datetime, timedelta, timezone

from tests.conftest import make_token


async def _seed_profile(db_pool, user_id, role, org_id):
    await db_pool.execute(
        "INSERT INTO profiles (id, role, org_id) VALUES ($1, $2, $3) "
        "ON CONFLICT (id) DO UPDATE SET role = excluded.role, org_id = excluded.org_id",
        user_id,
        role,
        org_id,
    )


async def _seed_org_data(db_pool, org_id, service_id, counter_id):
    today = date.today()
    now = datetime.now(timezone.utc)
    rows = [
        (uuid.uuid4(), org_id, service_id, today, "done", counter_id, now - timedelta(minutes=10), now - timedelta(minutes=5)),
        (uuid.uuid4(), org_id, service_id, today, "done", counter_id, now - timedelta(minutes=8), now - timedelta(minutes=3)),
        (uuid.uuid4(), org_id, service_id, today, "no_show", counter_id, None, None),
    ]
    for token_id, o, s, day, status, c, serving_at, finished_at in rows:
        await db_pool.execute(
            "INSERT INTO tokens (id, org_id, service_id, service_day, status, counter_id, serving_at, finished_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            token_id, o, s, day, status, c, serving_at, finished_at,
        )
    await db_pool.execute(
        "INSERT INTO board_services (service_id, day, org_id, waiting_count, avg_service_secs) "
        "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (service_id, day) DO NOTHING",
        service_id, today, org_id, 3, 300,
    )


async def test_patient_forbidden_from_staff_insights(client, db_pool):
    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "patient", org_id)
    token = make_token(sub=str(user_id))
    resp = client.get("/staff/insights", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_staff_sees_own_org_insights(client, db_pool):
    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    service_id = uuid.uuid4()
    counter_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "staff", org_id)
    await _seed_org_data(db_pool, org_id, service_id, counter_id)

    token = make_token(sub=str(user_id))
    resp = client.get("/staff/insights", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["org_id"] == str(org_id)
    counter_row = next(c for c in body["counters"] if c["counter_id"] == str(counter_id))
    assert counter_row["served_today"] == 2
    assert counter_row["no_show_today"] == 1
    assert counter_row["avg_service_minutes"] > 0
    service_row = next(s for s in body["services"] if s["service_id"] == str(service_id))
    assert service_row["waiting_count"] == 3


async def test_admin_also_allowed(client, db_pool):
    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    await _seed_profile(db_pool, user_id, "admin", org_id)
    token = make_token(sub=str(user_id))
    resp = client.get("/staff/insights", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


async def test_staff_never_sees_other_orgs_data(client, db_pool):
    staff_user = uuid.uuid4()
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    service_b = uuid.uuid4()
    counter_b = uuid.uuid4()

    await _seed_profile(db_pool, staff_user, "staff", org_a)
    # org A has no data seeded at all; org B does.
    await _seed_org_data(db_pool, org_b, service_b, counter_b)

    token = make_token(sub=str(staff_user))
    resp = client.get("/staff/insights", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["org_id"] == str(org_a)
    assert all(c["counter_id"] != str(counter_b) for c in body["counters"])
    assert all(s["service_id"] != str(service_b) for s in body["services"])
