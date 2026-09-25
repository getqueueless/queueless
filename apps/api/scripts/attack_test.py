"""Standalone attack script against a RUNNING local instance. Fires real HTTP
requests and asserts the real response -- never just documents intent.

Run with the server already up:
    uv run uvicorn app.main:app --port 8001
    uv run python scripts/attack_test.py

apps/api has no authenticated endpoint any more: POST /push-tokens was
removed (push_tokens is client-written under Supabase RLS, apps/api's own
DB role only has SELECT/DELETE on it -- see app/notifications.py). /predict
is deliberately public. So this script's surface is /predict's input
validation, rate limiting, and the confirmed-gone registration endpoint,
plus a CORS probe on /health. JWT verification and role authorization are
still fully covered by pytest (tests/test_auth.py, tests/test_authorization.py)
against the app's real dependency functions -- there just isn't a live
production route left to black-box attack them through.

/predict's 60/minute limit is roomy enough that every case below except the
dedicated flood test fits in one window with room to spare.
"""

import os
import sys
import uuid

import httpx

BASE_URL = os.environ.get("API_URL", "http://localhost:8001")

VALID_PREDICT_BODY = {
    "service_id": "10000000-0000-0000-0000-000000000001",
    "hour": 10,
    "weekday": 2,
    "queue_len_ahead": 5,
    "counters_open": 2,
}

results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append((name, condition, detail))
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not condition else ""))


def predict(client: httpx.Client, **overrides) -> httpx.Response:
    body = {**VALID_PREDICT_BODY, **overrides}
    return client.post("/predict", json=body)


def run() -> int:
    client = httpx.Client(base_url=BASE_URL, timeout=10.0)

    # 1. The old push-token registration endpoint must actually be gone, not
    #    just undocumented -- it used to accept an INSERT the DB role can't
    #    even perform against the real schema.
    resp = client.post(
        "/push-tokens", json={"token": "ExponentPushToken[x]", "device_id": "d1"}
    )
    check("removed_registration_endpoint_returns_404", resp.status_code == 404, f"got {resp.status_code}")

    # 2. Malformed service_id -- not a UUID at all.
    resp = predict(client, service_id="not-a-uuid")
    check("malformed_service_id_rejected", resp.status_code == 422, f"got {resp.status_code}")

    # 3. Injection-shaped strings in service_id -- must 422 (invalid UUID
    #    shape), never 500. The UUID type itself is what blocks these; there
    #    is no free-text field left in this API for a string-injection test.
    injection_payloads = [
        "' OR '1'='1",
        '"; DROP TABLE tokens;--',
        '{"$ne": null}',
        "../../etc/passwd",
    ]
    for payload in injection_payloads:
        resp = predict(client, service_id=payload)
        check(
            f"injection_payload_never_500[{payload[:20]!r}]",
            resp.status_code == 422 and resp.status_code != 500,
            f"got {resp.status_code}",
        )

    # 4. Syntactically valid but nonexistent service_id -- 404, not a leak of
    #    "which ids are real" via a different error shape, and never 500.
    resp = predict(client, service_id=str(uuid.uuid4()))
    check("unknown_service_id_rejected", resp.status_code == 404, f"got {resp.status_code}")

    # 5. Out-of-range and wrong-type values on the numeric fields.
    resp = predict(client, hour=24)
    check("out_of_range_hour_rejected", resp.status_code == 422, f"got {resp.status_code}")

    resp = predict(client, hour="ten")
    check("wrong_type_hour_rejected", resp.status_code == 422, f"got {resp.status_code}")

    # 6. Mass-assignment: an extra field the client had no business sending.
    resp = client.post("/predict", json={**VALID_PREDICT_BODY, "admin": True})
    check("extra_field_rejected", resp.status_code == 422, f"got {resp.status_code}")

    # 7. Flood / rate-limit proof (60/minute). A handful of prior requests
    #    above already used a little budget, so 61 more is a safe margin to
    #    guarantee at least one 429 with Retry-After in this same window.
    last = None
    for _ in range(61):
        last = predict(client)
    check("rate_limit_429_eventually", last is not None and last.status_code == 429, f"got {last.status_code if last else 'no response'}")
    check(
        "rate_limit_retry_after_header_present",
        last is not None and "retry-after" in {k.lower() for k in last.headers},
        f"headers={dict(last.headers) if last else {}}",
    )

    # 8. CORS probe -- evil origin must never be echoed back. /health is
    #    exempt from rate limiting so this needs no window of its own.
    resp = client.get("/health", headers={"Origin": "https://evil.example"})
    acao = resp.headers.get("access-control-allow-origin")
    check("cors_origin_never_echoed", acao != "https://evil.example", f"got ACAO={acao!r}")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(run())
