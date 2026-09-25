import uuid


def test_sixty_first_predict_request_in_a_minute_is_rate_limited(client):
    # apps/api's only remaining rate-limited route since /push-tokens was
    # removed (push_tokens is client-written under RLS, see notifications.py).
    # An unknown service_id still counts against the budget -- the limiter is
    # a route-level dependency that resolves before body validation.
    payload = {
        "service_id": str(uuid.uuid4()),
        "hour": 10,
        "weekday": 2,
        "queue_len_ahead": 1,
        "counters_open": 1,
    }
    last = None
    for _ in range(61):
        last = client.post("/predict", json=payload)
    assert last.status_code == 429
    assert "retry-after" in {k.lower() for k in last.headers}


def test_health_never_rate_limited(client):
    for _ in range(10):
        resp = client.get("/health")
        assert resp.status_code == 200


def test_ready_never_rate_limited(client):
    for _ in range(10):
        resp = client.get("/ready")
        assert resp.status_code == 200


def test_sixth_retrain_request_in_ten_minutes_is_rate_limited(client):
    # Same technique as the /predict 60/minute case above: firing N requests
    # back-to-back proves the limit without waiting for the real window to
    # pass. Chosen over a live 10-minute run in scripts/attack_test.py,
    # which would make every run of that script take 10+ minutes for one
    # case -- this is the same rate-limit *logic*, proven fast and
    # deterministically here instead.
    last = None
    for _ in range(6):
        last = client.post("/admin/retrain")
    assert last.status_code == 429
    assert "retry-after" in {k.lower() for k in last.headers}
