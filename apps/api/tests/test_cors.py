def test_evil_origin_never_echoed(client):
    resp = client.get("/health", headers={"Origin": "https://evil.example"})
    assert resp.headers.get("access-control-allow-origin") != "https://evil.example"


def test_allowed_origin_is_echoed(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
