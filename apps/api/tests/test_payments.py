"""POST /payments/order, /payments/verify, /payments/razorpay/webhook,
/admin/refunds. Razorpay's own HTTP API is mocked (FakeRazorpayClient);
everything DB-side runs against the real fixture Postgres (scripts/dev_db.py
mirrors record_order/confirm_payment/mark_payment_failed/record_refund
exactly, see that file's own comment). Covers the four attack scenarios the
task called out explicitly: forged signature (401), a replayed webhook
event (no double effect), a tampered amount (rejected at the DB contract
level), and another patient's token (403)."""

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import make_token

WEBHOOK_SECRET = "whsec_test_180"
KEY_SECRET = "keysecret_test_180"


class FakeRazorpayClient:
    key_id = "rzp_test_fake"

    def __init__(self):
        self.orders_created = []
        self.refunds_created = []

    async def aclose(self):
        pass

    async def create_order(self, amount_paise, currency, receipt):
        order_id = f"order_{uuid.uuid4().hex[:12]}"
        self.orders_created.append((order_id, amount_paise, currency, receipt))
        return {"id": order_id, "amount": amount_paise, "currency": currency}

    async def create_refund(self, razorpay_payment_id, amount_paise):
        refund_id = f"rfnd_{uuid.uuid4().hex[:12]}"
        self.refunds_created.append((refund_id, razorpay_payment_id, amount_paise))
        return {"id": refund_id, "amount": amount_paise}


def _sign_checkout(order_id: str, payment_id: str) -> str:
    return hmac.new(KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _sign_webhook(body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def _patch_settings(app, monkeypatch):
    monkeypatch.setattr(app.state.settings, "razorpay_key_secret", KEY_SECRET)
    monkeypatch.setattr(app.state.settings, "razorpay_webhook_secret", WEBHOOK_SECRET)


async def _seed_pending_token(db_pool, patient_id, fee_inr=500, hold_minutes=10):
    token_id = uuid.uuid4()
    org_id = uuid.uuid4()
    service_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, status, patient_id, fee_inr, hold_expires_at) "
        "VALUES ($1, $2, $3, 'pending_payment', $4, $5, $6)",
        token_id, org_id, service_id, patient_id, fee_inr,
        datetime.now(timezone.utc) + timedelta(minutes=hold_minutes),
    )
    return token_id, org_id


async def _seed_pending_appointment(db_pool, patient_id, fee_inr=500, hold_minutes=10):
    appointment_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO appointments (id, patient_id, status, fee_inr, hold_expires_at) "
        "VALUES ($1, $2, 'pending_payment', $3, $4)",
        appointment_id, patient_id, fee_inr,
        datetime.now(timezone.utc) + timedelta(minutes=hold_minutes),
    )
    return appointment_id


# ---- POST /payments/order ----------------------------------------------


async def test_order_requires_owning_patient(client, db_pool):
    owner = uuid.uuid4()
    other = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, owner)

    resp = client.post(
        "/payments/order", json={"token_id": str(token_id)},
        headers={"Authorization": f"Bearer {make_token(sub=str(other))}"},
    )
    assert resp.status_code == 403


async def test_order_404_unknown_token(client):
    resp = client.post(
        "/payments/order", json={"token_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert resp.status_code == 404


async def test_order_409_not_pending_payment(client, db_pool):
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient)
    await db_pool.execute("UPDATE tokens SET status = 'waiting' WHERE id = $1", token_id)

    resp = client.post(
        "/payments/order", json={"token_id": str(token_id)},
        headers={"Authorization": f"Bearer {make_token(sub=str(patient))}"},
    )
    assert resp.status_code == 409


async def test_order_409_hold_expired(client, db_pool):
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient, hold_minutes=-1)

    resp = client.post(
        "/payments/order", json={"token_id": str(token_id)},
        headers={"Authorization": f"Bearer {make_token(sub=str(patient))}"},
    )
    assert resp.status_code == 409


async def test_order_503_when_razorpay_unconfigured(client, db_pool):
    from app.main import app

    app.state.razorpay_client = None
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient)

    resp = client.post(
        "/payments/order", json={"token_id": str(token_id)},
        headers={"Authorization": f"Bearer {make_token(sub=str(patient))}"},
    )
    assert resp.status_code == 503


async def test_order_success_creates_razorpay_order_and_payments_row(client, db_pool):
    from app.main import app

    fake = FakeRazorpayClient()
    app.state.razorpay_client = fake
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient, fee_inr=750)

    resp = client.post(
        "/payments/order", json={"token_id": str(token_id)},
        headers={"Authorization": f"Bearer {make_token(sub=str(patient))}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["amount_inr"] == 750
    assert body["key_id"] == "rzp_test_fake"
    assert fake.orders_created[0][1] == 75_000  # paise, not rupees

    row = await db_pool.fetchrow("SELECT * FROM payments WHERE token_id = $1", token_id)
    assert row["status"] == "created"
    assert row["amount_inr"] == 750


async def test_order_success_for_appointment_creates_razorpay_order_and_payments_row(client, db_pool):
    from app.main import app

    fake = FakeRazorpayClient()
    app.state.razorpay_client = fake
    patient = uuid.uuid4()
    appointment_id = await _seed_pending_appointment(db_pool, patient, fee_inr=500)

    resp = client.post(
        "/payments/order", json={"appointment_id": str(appointment_id)},
        headers={"Authorization": f"Bearer {make_token(sub=str(patient))}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["amount_inr"] == 500
    assert body["appointment_id"] == str(appointment_id)
    assert body["token_id"] is None

    row = await db_pool.fetchrow("SELECT * FROM payments WHERE appointment_id = $1", appointment_id)
    assert row["status"] == "created"
    assert row["token_id"] is None


async def test_order_rejects_both_token_and_appointment(client):
    resp = client.post(
        "/payments/order",
        json={"token_id": str(uuid.uuid4()), "appointment_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert resp.status_code == 422


async def test_order_rejects_neither_token_nor_appointment(client):
    resp = client.post(
        "/payments/order", json={},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert resp.status_code == 422


# ---- POST /payments/verify ----------------------------------------------


async def test_verify_other_patients_token_403(client, db_pool, monkeypatch):
    from app.main import app

    _patch_settings(app, monkeypatch)
    owner = uuid.uuid4()
    attacker = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, owner)

    resp = client.post(
        "/payments/verify",
        json={
            "token_id": str(token_id), "razorpay_order_id": "order_x",
            "razorpay_payment_id": "pay_x", "razorpay_signature": "whatever",
        },
        headers={"Authorization": f"Bearer {make_token(sub=str(attacker))}"},
    )
    assert resp.status_code == 403


async def test_verify_forged_signature_401(client, db_pool, monkeypatch):
    from app.main import app

    _patch_settings(app, monkeypatch)
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient)

    resp = client.post(
        "/payments/verify",
        json={
            "token_id": str(token_id), "razorpay_order_id": "order_x",
            "razorpay_payment_id": "pay_x", "razorpay_signature": "deadbeef" * 8,
        },
        headers={"Authorization": f"Bearer {make_token(sub=str(patient))}"},
    )
    assert resp.status_code == 401


async def test_verify_success_and_replay_has_no_double_effect(client, db_pool, monkeypatch):
    from app.main import app

    _patch_settings(app, monkeypatch)
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient, fee_inr=500)
    await db_pool.execute(
        "INSERT INTO payments (org_id, token_id, razorpay_order_id, amount_inr, status) "
        "SELECT org_id, id, 'order_v1', 500, 'created' FROM tokens WHERE id = $1",
        token_id,
    )
    signature = _sign_checkout("order_v1", "pay_v1")
    body = {
        "token_id": str(token_id), "razorpay_order_id": "order_v1",
        "razorpay_payment_id": "pay_v1", "razorpay_signature": signature,
    }
    headers = {"Authorization": f"Bearer {make_token(sub=str(patient))}"}

    resp1 = client.post("/payments/verify", json=body, headers=headers)
    assert resp1.status_code == 200
    assert resp1.json()["token_status"] == "waiting"

    # replay -- same signature, same call again (e.g. the browser callback
    # firing twice, or racing the webhook): must not error and must not
    # double-apply anything.
    resp2 = client.post("/payments/verify", json=body, headers=headers)
    assert resp2.status_code == 200
    assert resp2.json()["token_status"] == "waiting"

    count = await db_pool.fetchval(
        "SELECT count(*) FROM payments WHERE razorpay_order_id = 'order_v1'"
    )
    assert count == 1


async def test_verify_success_for_appointment_updates_status_to_booked(client, db_pool, monkeypatch):
    from app.main import app

    _patch_settings(app, monkeypatch)
    patient = uuid.uuid4()
    appointment_id = await _seed_pending_appointment(db_pool, patient, fee_inr=500)
    await db_pool.execute(
        "INSERT INTO payments (appointment_id, razorpay_order_id, amount_inr, status) "
        "VALUES ($1, 'order_appt_v1', 500, 'created')",
        appointment_id,
    )
    signature = _sign_checkout("order_appt_v1", "pay_appt_v1")
    body = {
        "appointment_id": str(appointment_id), "razorpay_order_id": "order_appt_v1",
        "razorpay_payment_id": "pay_appt_v1", "razorpay_signature": signature,
    }
    headers = {"Authorization": f"Bearer {make_token(sub=str(patient))}"}

    resp = client.post("/payments/verify", json=body, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["appointment_status"] == "booked"
    assert resp.json()["token_status"] is None

    status = await db_pool.fetchval("SELECT status FROM appointments WHERE id = $1", appointment_id)
    assert status == "booked"


# ---- DB-level: the amount check is enforced independent of the caller ---


async def test_confirm_payment_rejects_a_tampered_amount(db_pool):
    """record_order/confirm_payment are the shared contract both the HTTP
    route and the webhook call through -- this proves the DB layer itself
    refuses a mismatched amount regardless of caller, the defense-in-depth
    the task asked for (never trust a client- or webhook-declared amount
    blindly)."""
    token_id = uuid.uuid4()
    org_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, status, fee_inr) "
        "VALUES ($1, $2, $3, 'pending_payment', 500)",
        token_id, org_id, uuid.uuid4(),
    )
    order = await db_pool.fetchrow(
        "SELECT * FROM record_order($1, $2, $3, $4)", token_id, None, "order_tamper", 500
    )
    assert order["status"] == "created"

    tampered = await db_pool.fetchrow(
        "SELECT * FROM confirm_payment($1, $2, $3)", "order_tamper", "pay_tamper", 1
    )
    # confirm_payment returns the SQL NULL payments composite on rejection --
    # `SELECT * FROM fn()` unpacks that into one row of all-NULL columns, not
    # zero rows (a real gotcha this file's app code had too, fixed alongside
    # this test -- see routes.py/refund_job.py's matching comments).
    assert tampered["id"] is None

    still_pending = await db_pool.fetchval("SELECT status FROM tokens WHERE id = $1", token_id)
    assert still_pending == "pending_payment"


# ---- POST /payments/razorpay/webhook -------------------------------------


async def test_webhook_401_on_bad_signature(client, monkeypatch):
    from app.main import app

    _patch_settings(app, monkeypatch)
    resp = client.post(
        "/payments/razorpay/webhook",
        content=b'{"event":"payment.captured"}',
        headers={"x-razorpay-signature": "wrong", "content-type": "application/json"},
    )
    assert resp.status_code == 401


async def test_webhook_captures_and_replay_is_a_noop(client, db_pool, monkeypatch):
    from app.main import app

    _patch_settings(app, monkeypatch)
    patient = uuid.uuid4()
    token_id, _ = await _seed_pending_token(db_pool, patient, fee_inr=500)
    await db_pool.execute(
        "INSERT INTO payments (org_id, token_id, razorpay_order_id, amount_inr, status) "
        "SELECT org_id, id, 'order_wh1', 500, 'created' FROM tokens WHERE id = $1",
        token_id,
    )
    payload = {
        "id": "evt_wh1",
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_wh1", "order_id": "order_wh1", "amount": 50000}}},
    }
    raw = json.dumps(payload).encode()
    headers = {"x-razorpay-signature": _sign_webhook(raw), "content-type": "application/json"}

    resp1 = client.post("/payments/razorpay/webhook", content=raw, headers=headers)
    assert resp1.status_code == 200
    assert resp1.json()["status"] == "ok"
    assert await db_pool.fetchval("SELECT status FROM tokens WHERE id = $1", token_id) == "waiting"

    resp2 = client.post("/payments/razorpay/webhook", content=raw, headers=headers)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "duplicate"

    count = await db_pool.fetchval("SELECT count(*) FROM payments WHERE razorpay_order_id = 'order_wh1'")
    assert count == 1


# ---- POST /admin/refunds -------------------------------------------------


async def test_admin_refund_requires_admin_role(client, db_pool):
    from app.main import app

    app.state.razorpay_client = FakeRazorpayClient()
    non_admin = uuid.uuid4()
    org_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO profiles (id, role, org_id) VALUES ($1, 'staff', $2)", non_admin, org_id,
    )
    resp = client.post(
        "/admin/refunds", json={"payment_id": str(uuid.uuid4()), "reason": "test"},
        headers={"Authorization": f"Bearer {make_token(sub=str(non_admin))}"},
    )
    assert resp.status_code == 403


async def test_admin_refund_success(client, db_pool):
    from app.main import app

    fake = FakeRazorpayClient()
    app.state.razorpay_client = fake
    admin = uuid.uuid4()
    org_id = uuid.uuid4()
    await db_pool.execute("INSERT INTO profiles (id, role, org_id) VALUES ($1, 'admin', $2)", admin, org_id)

    token_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, status, fee_inr) VALUES ($1, $2, $3, 'waiting', 500)",
        token_id, org_id, uuid.uuid4(),
    )
    payment = await db_pool.fetchrow(
        "INSERT INTO payments (org_id, token_id, razorpay_order_id, razorpay_payment_id, amount_inr, status, captured_at) "
        "VALUES ($1, $2, 'order_r1', 'pay_r1', 500, 'captured', now()) RETURNING id",
        org_id, token_id,
    )

    resp = client.post(
        "/admin/refunds", json={"payment_id": str(payment["id"]), "reason": "patient no-show refund policy"},
        headers={"Authorization": f"Bearer {make_token(sub=str(admin))}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "refunded"
    assert fake.refunds_created[0][1] == "pay_r1"

    row_status = await db_pool.fetchval("SELECT status FROM payments WHERE id = $1", payment["id"])
    assert row_status == "refunded"


async def test_admin_refund_other_org_payment_404s(client, db_pool):
    from app.main import app

    app.state.razorpay_client = FakeRazorpayClient()
    admin = uuid.uuid4()
    admin_org = uuid.uuid4()
    other_org = uuid.uuid4()
    await db_pool.execute("INSERT INTO profiles (id, role, org_id) VALUES ($1, 'admin', $2)", admin, admin_org)

    token_id = uuid.uuid4()
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, status) VALUES ($1, $2, $3, 'waiting')",
        token_id, other_org, uuid.uuid4(),
    )
    payment = await db_pool.fetchrow(
        "INSERT INTO payments (org_id, token_id, razorpay_order_id, razorpay_payment_id, amount_inr, status, captured_at) "
        "VALUES ($1, $2, 'order_r2', 'pay_r2', 500, 'captured', now()) RETURNING id",
        other_org, token_id,
    )

    resp = client.post(
        "/admin/refunds", json={"payment_id": str(payment["id"]), "reason": "x"},
        headers={"Authorization": f"Bearer {make_token(sub=str(admin))}"},
    )
    assert resp.status_code == 404
