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


def test_csp_includes_frame_ancestors_none():
    # default-src 'none' does NOT imply frame-ancestors -- CSP gives that
    # directive its own default (unrestricted) when omitted, so it must be
    # named explicitly. Modern browsers prefer this over the older
    # X-Frame-Options header (also set, for older browsers).
    from app.middleware import SECURITY_HEADERS

    assert "frame-ancestors 'none'" in SECURITY_HEADERS["Content-Security-Policy"]


def test_docs_relaxed_csp_still_includes_frame_ancestors_none(client):
    resp = client.get("/docs")
    assert "frame-ancestors 'none'" in resp.headers["content-security-policy"]
