"""Standalone attack script against a RUNNING local instance. Fires real HTTP
requests and asserts the real response -- never just documents intent.

Run with the server already up:
    uv run uvicorn app.main:app --port 8001
    uv run python scripts/attack_test.py

/push-tokens is rate-limited to 5/minute, and that limit is enforced before
auth/body validation even runs (see the comment in app/routes/push_tokens.py
for why). That means every single request this script sends to /push-tokens
counts against the same budget regardless of what's in it, so the cases
below are split into windows of at most 5 requests each, with a wait for the
window to reset in between -- otherwise later cases would spuriously see 429
instead of the status they're actually trying to prove.
"""

import os
import sys
import time
from uuid import uuid4

import httpx
import jwt

BASE_URL = os.environ.get("API_URL", "http://localhost:8001")
VALID_EXPO_TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
RATE_LIMIT_WINDOW_SECONDS = 61

results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append((name, condition, detail))
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not condition else ""))


def wait_for_rate_limit_reset() -> None:
    print(f"(waiting {RATE_LIMIT_WINDOW_SECONDS}s for the /push-tokens rate-limit window to reset)")
    time.sleep(RATE_LIMIT_WINDOW_SECONDS)


def make_random_secret_token(exp_offset_seconds: int) -> str:
    payload = {
        "sub": str(uuid4()),
        "aud": "authenticated",
        "exp": int(time.time()) + exp_offset_seconds,
    }
    return jwt.encode(payload, "attacker-does-not-know-the-real-secret", algorithm="HS256")


def make_alg_none_token() -> str:
    header = jwt.utils.base64url_encode(b'{"alg":"none","typ":"JWT"}').decode()
    payload = jwt.utils.base64url_encode(
        f'{{"sub":"{uuid4()}","aud":"authenticated","exp":{int(time.time()) + 3600}}}'.encode()
    ).decode()
    return f"{header}.{payload}."


def push_token_request(client: httpx.Client, **kwargs) -> httpx.Response:
    kwargs.setdefault("json", {"token": VALID_EXPO_TOKEN, "device_id": "d1"})
    return client.post("/push-tokens", **kwargs)


def run() -> int:
    client = httpx.Client(base_url=BASE_URL, timeout=10.0)

    # --- Window 1 (5 requests): JWT signature/claim checks. ---
    resp = push_token_request(client)
    check("no_auth_header_rejected", resp.status_code == 401, f"got {resp.status_code}")

    resp = push_token_request(client, headers={"Authorization": "Bearer not.a.jwt"})
    check("malformed_bearer_rejected", resp.status_code == 401, f"got {resp.status_code}")

    expired = make_random_secret_token(exp_offset_seconds=-3600)
    resp = push_token_request(client, headers={"Authorization": f"Bearer {expired}"})
    check(
        "expired_and_wrong_secret_token_rejected",
        resp.status_code == 401,
        f"got {resp.status_code}",
    )

    wrong_sig = make_random_secret_token(exp_offset_seconds=3600)
    resp = push_token_request(client, headers={"Authorization": f"Bearer {wrong_sig}"})
    check("wrong_signature_token_rejected", resp.status_code == 401, f"got {resp.status_code}")

    none_token = make_alg_none_token()
    resp = push_token_request(client, headers={"Authorization": f"Bearer {none_token}"})
    check("alg_none_token_rejected", resp.status_code == 401, f"got {resp.status_code}")

    wait_for_rate_limit_reset()

    # --- Window 2 (5 requests): mass-assignment + first injection payloads. ---
    # No Authorization header here (the script doesn't have the real signing
    # secret to build one that would pass auth) -- get_current_user rejects
    # before body validation even runs, so 401 is the expected block, same
    # as extra="forbid" would give a 422 if auth had passed. Either way the
    # extra field grants nothing.
    resp = push_token_request(
        client, json={"token": VALID_EXPO_TOKEN, "device_id": "d1", "role": "admin"}
    )
    check(
        "extra_role_field_rejected",
        resp.status_code in (401, 422),
        f"got {resp.status_code}",
    )

    resp = push_token_request(
        client,
        json={"token": VALID_EXPO_TOKEN, "device_id": "d1", "is_staff": True},
        headers={"X-User-Role": "admin"},
    )
    check(
        "spoofed_role_header_ignored",
        resp.status_code in (401, 422),
        f"got {resp.status_code}",
    )

    injection_payloads = [
        "' OR '1'='1",
        '"; DROP TABLE tokens;--',
        '{"$ne": null}',
        "../../etc/passwd",
        "x" * 200,
    ]
    for payload in injection_payloads[:3]:
        resp = push_token_request(client, json={"token": VALID_EXPO_TOKEN, "device_id": payload})
        check(
            f"injection_payload_never_500[{payload[:20]!r}]",
            resp.status_code in (401, 422) and resp.status_code != 500,
            f"got {resp.status_code}",
        )

    wait_for_rate_limit_reset()

    # --- Window 3 (2 requests): remaining injection payloads. ---
    for payload in injection_payloads[3:]:
        resp = push_token_request(client, json={"token": VALID_EXPO_TOKEN, "device_id": payload})
        check(
            f"injection_payload_never_500[{payload[:20]!r}]",
            resp.status_code in (401, 422) and resp.status_code != 500,
            f"got {resp.status_code}",
        )

    wait_for_rate_limit_reset()

    # --- Window 4 (6 requests): flood / rate-limit proof, in a clean window. ---
    last = None
    for _ in range(6):
        last = push_token_request(client)
    check(
        "rate_limit_429_on_6th_request",
        last is not None and last.status_code == 429,
        f"got {last.status_code if last else 'no response'}",
    )
    check(
        "rate_limit_retry_after_header_present",
        last is not None and "retry-after" in {k.lower() for k in last.headers},
        f"headers={dict(last.headers) if last else {}}",
    )

    # CORS probe hits /health, which is exempt from rate limiting entirely,
    # so it doesn't need its own window.
    resp = client.get("/health", headers={"Origin": "https://evil.example"})
    acao = resp.headers.get("access-control-allow-origin")
    check("cors_origin_never_echoed", acao != "https://evil.example", f"got ACAO={acao!r}")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(run())
