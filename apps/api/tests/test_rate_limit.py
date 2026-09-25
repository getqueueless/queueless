VALID_EXPO_TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"


def test_sixth_request_in_a_minute_is_rate_limited(client):
    last = None
    for _ in range(6):
        last = client.post(
            "/push-tokens", json={"token": VALID_EXPO_TOKEN, "device_id": "flood"}
        )
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
