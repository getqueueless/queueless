import uuid

from prometheus_client import generate_latest

from app.notifications import poll_tick


def test_metrics_endpoint_exposes_prometheus_format(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert b"# HELP" in resp.content


def test_metrics_excluded_from_openapi_schema(client):
    schema = client.get("/openapi.json").json()
    assert "/metrics" not in schema["paths"]


async def test_queue_depth_gauge_reflects_waiting_tokens(db_pool):
    await db_pool.execute(
        "INSERT INTO tokens(id, service, status, user_id, created_at) "
        "VALUES ($1, 'general_opd', 'waiting', $2, now())",
        uuid.uuid4(),
        uuid.uuid4(),
    )
    await poll_tick(db_pool)
    body = generate_latest().decode()
    assert 'queue_depth{service="general_opd"} 1.0' in body
