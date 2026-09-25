import time

import jwt

from tests.conftest import TEST_JWT_SECRET, make_token


def test_valid_token_accepted(client):
    token = make_token()
    resp = client.get("/_test/identity", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_missing_header_rejected(client):
    resp = client.get("/_test/identity")
    assert resp.status_code == 401


def test_malformed_bearer_rejected(client):
    resp = client.get("/_test/identity", headers={"Authorization": "Bearer not.a.jwt"})
    assert resp.status_code == 401


def test_expired_token_rejected(client):
    token = make_token(exp=int(time.time()) - 10)
    resp = client.get("/_test/identity", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_wrong_signature_rejected(client):
    token = make_token(secret="a-completely-different-secret")
    resp = client.get("/_test/identity", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_alg_none_rejected(client):
    header = jwt.utils.base64url_encode(b'{"alg":"none","typ":"JWT"}').decode()
    payload = jwt.utils.base64url_encode(
        b'{"sub":"11111111-1111-1111-1111-111111111111","aud":"authenticated","exp":9999999999}'
    ).decode()
    token = f"{header}.{payload}."
    resp = client.get("/_test/identity", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_missing_audience_rejected(client):
    token = jwt.encode(
        {"sub": "11111111-1111-1111-1111-111111111111", "exp": int(time.time()) + 3600},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    resp = client.get("/_test/identity", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
