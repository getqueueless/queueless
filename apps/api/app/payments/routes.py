import json
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth import AuthedProfile, AuthedUser, get_current_user, require_org_role
from app.payments.razorpay_client import RazorpayError
from app.payments.schemas import (
    AdminRefundRequest,
    OrderRequest,
    OrderResponse,
    VerifyRequest,
    VerifyResponse,
)
from app.payments.signature import verify_payment_signature, verify_webhook_signature
from app.rate_limit import limiter

router = APIRouter()
log = structlog.get_logger()


# Route-level dependencies, not decorators on the endpoints themselves -- see
# app/routes/predict.py's matching comment: a limit on the endpoint's own
# function only runs after FastAPI has already resolved every other
# dependency (auth included), so a flood would be fully authed/parsed before
# ever getting counted.
@limiter.limit("10/minute")
async def _order_rate_limit(request: Request, response: Response) -> None:
    return None


@limiter.limit("20/minute")
async def _verify_rate_limit(request: Request, response: Response) -> None:
    return None


@limiter.limit("120/minute")
async def _webhook_rate_limit(request: Request, response: Response) -> None:
    return None


async def _load_hold(pool, body: OrderRequest | VerifyRequest, user: AuthedUser) -> tuple[str, dict]:
    """Resolves the token or appointment a hold request is about. Returns (target, row) where
    target is 'token' or 'appointment' -- the two are otherwise handled identically."""
    if body.token_id is not None:
        row = await pool.fetchrow(
            "SELECT id, patient_id, status, fee_inr, hold_expires_at FROM tokens WHERE id = $1",
            body.token_id,
        )
        target = "token"
    else:
        row = await pool.fetchrow(
            "SELECT id, patient_id, status, fee_inr, hold_expires_at FROM appointments WHERE id = $1",
            body.appointment_id,
        )
        target = "appointment"
    if row is None:
        raise HTTPException(404, "not_found")
    if row["patient_id"] != user.user_id:
        raise HTTPException(403, "forbidden")
    return target, row


@router.post("/payments/order", response_model=OrderResponse, dependencies=[Depends(_order_rate_limit)])
async def create_order(
    request: Request, body: OrderRequest, user: AuthedUser = Depends(get_current_user)
) -> OrderResponse:
    pool = request.app.state.db_pool

    target, row = await _load_hold(pool, body, user)
    if row["status"] != "pending_payment":
        raise HTTPException(409, "not_pending_payment")
    if row["hold_expires_at"] is None or row["hold_expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(409, "hold_expired")

    amount_inr = row["fee_inr"] or 0
    if amount_inr <= 0:
        raise HTTPException(422, "invalid_amount")

    client = request.app.state.razorpay_client
    if client is None:
        raise HTTPException(503, "payments_unavailable")

    try:
        order = await client.create_order(
            amount_paise=amount_inr * 100, currency="INR", receipt=str(row["id"])
        )
    except RazorpayError as exc:
        log.error("razorpay_create_order_failed", target=target, id=str(row["id"]), status=exc.status_code)
        raise HTTPException(502, "razorpay_error") from exc

    payment = await pool.fetchrow(
        "SELECT * FROM record_order($1, $2, $3, $4)",
        row["id"] if target == "token" else None,
        row["id"] if target == "appointment" else None,
        order["id"], amount_inr,
    )
    # record_order returns the SQL NULL public.payments composite on
    # rejection -- `SELECT * FROM fn()` unpacks that into one row of all-NULL
    # columns, not zero rows, so `payment is None` would never be true here.
    # id is the primary key: never null on a real row.
    if payment is None or payment["id"] is None:
        # The hold stopped being pending_payment between the check above and
        # here (e.g. it expired mid-request) -- the Razorpay order now exists
        # unused, which is harmless (it just expires unpaid on their side).
        raise HTTPException(409, "not_pending_payment")

    return OrderResponse(
        order_id=order["id"], amount_inr=amount_inr, currency="INR", key_id=client.key_id,
        token_id=row["id"] if target == "token" else None,
        appointment_id=row["id"] if target == "appointment" else None,
    )


@router.post("/payments/verify", response_model=VerifyResponse, dependencies=[Depends(_verify_rate_limit)])
async def verify_payment(
    request: Request, body: VerifyRequest, user: AuthedUser = Depends(get_current_user)
) -> VerifyResponse:
    settings = request.app.state.settings
    pool = request.app.state.db_pool

    target, row = await _load_hold(pool, body, user)

    if not settings.razorpay_key_secret or not verify_payment_signature(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature,
        settings.razorpay_key_secret,
    ):
        raise HTTPException(401, "invalid_signature")

    amount_inr = row["fee_inr"] or 0
    payment = await pool.fetchrow(
        "SELECT * FROM confirm_payment($1, $2, $3)",
        body.razorpay_order_id, body.razorpay_payment_id, amount_inr,
    )
    # Same NULL-composite-unpacks-to-a-row-of-nulls trap as record_order above.
    if payment is None or payment["id"] is None:
        raise HTTPException(409, "payment_rejected")

    if target == "token":
        status = await pool.fetchval("SELECT status FROM tokens WHERE id = $1", row["id"])
        return VerifyResponse(status="captured", token_status=status)
    status = await pool.fetchval("SELECT status FROM appointments WHERE id = $1", row["id"])
    return VerifyResponse(status="captured", appointment_status=status)


@router.post("/payments/razorpay/webhook", status_code=200, dependencies=[Depends(_webhook_rate_limit)])
async def razorpay_webhook(request: Request) -> dict:
    settings = request.app.state.settings
    pool = request.app.state.db_pool

    raw_body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    if not settings.razorpay_webhook_secret or not verify_webhook_signature(
        raw_body, signature, settings.razorpay_webhook_secret
    ):
        raise HTTPException(401, "invalid_signature")

    try:
        payload = json.loads(raw_body)
    except ValueError as exc:
        raise HTTPException(400, "invalid_body") from exc

    event_id = request.headers.get("x-razorpay-event-id") or payload.get("id")
    event_type = payload.get("event", "")
    if not event_id:
        raise HTTPException(400, "missing_event_id")

    # Dedupe + processing share one transaction: if anything below raises, the
    # dedupe row rolls back too, so a genuine retry from Razorpay (same event
    # id, since it never saw a 2xx) is processed cleanly instead of being
    # silently swallowed as "already seen".
    async with pool.acquire() as conn:
        async with conn.transaction():
            claimed = await conn.fetchval(
                "INSERT INTO private.razorpay_webhook_events (event_id) VALUES ($1) "
                "ON CONFLICT DO NOTHING RETURNING event_id",
                event_id,
            )
            if claimed is None:
                return {"status": "duplicate"}

            payment_entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
            order_id = payment_entity.get("order_id")
            payment_id = payment_entity.get("id")
            amount_paise = payment_entity.get("amount")

            if event_type in ("payment.captured", "order.paid") and order_id and payment_id:
                amount_inr = (amount_paise or 0) // 100
                await conn.fetchrow(
                    "SELECT * FROM confirm_payment($1, $2, $3)", order_id, payment_id, amount_inr
                )
            elif event_type == "payment.failed" and order_id:
                reason = payment_entity.get("error_description")
                await conn.fetchrow("SELECT * FROM mark_payment_failed($1, $2)", order_id, reason)
            # refund.processed / refund.failed: refunds are always initiated by
            # this app (admin action or the doctor-leave job), which already
            # calls record_refund itself -- these events are logged only, not
            # re-applied, to avoid a race with that call.
            else:
                log.info("razorpay_webhook_ignored", event_type=event_type)

    return {"status": "ok"}


@router.post("/admin/refunds")
async def admin_refund(
    request: Request, body: AdminRefundRequest,
    profile: AuthedProfile = Depends(require_org_role("admin")),
) -> dict:
    pool = request.app.state.db_pool
    client = request.app.state.razorpay_client
    if client is None:
        raise HTTPException(503, "payments_unavailable")

    payment = await pool.fetchrow(
        "SELECT id, org_id, razorpay_payment_id, amount_inr, status FROM payments WHERE id = $1",
        body.payment_id,
    )
    if payment is None or payment["org_id"] != profile.org_id:
        raise HTTPException(404, "not_found")
    if payment["status"] != "captured":
        raise HTTPException(409, "not_refundable")

    try:
        refund = await client.create_refund(
            razorpay_payment_id=payment["razorpay_payment_id"],
            amount_paise=payment["amount_inr"] * 100,
        )
    except RazorpayError as exc:
        log.error("razorpay_refund_failed", payment_id=str(payment["id"]), status=exc.status_code)
        raise HTTPException(502, "razorpay_error") from exc

    updated = await pool.fetchrow(
        "SELECT * FROM record_refund($1, $2, $3, $4)",
        payment["id"], refund["id"], body.reason, profile.user_id,
    )
    # Same NULL-composite-unpacks-to-a-row-of-nulls trap as record_order above.
    if updated is None or updated["id"] is None:
        raise HTTPException(409, "not_refundable")

    return {"status": "refunded", "razorpay_refund_id": refund["id"]}
