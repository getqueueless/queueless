def test_request_id_echoed(client):
    resp = client.get("/health", headers={"x-request-id": "abc-123"})
    assert resp.headers["x-request-id"] == "abc-123"


def test_request_id_generated_when_absent(client):
    resp = client.get("/health")
    assert resp.headers["x-request-id"]


def test_security_headers_present(client):
    resp = client.get("/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert "strict-transport-security" not in resp.headers
