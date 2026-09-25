"""Auto-refund job: periodically finds captured payments whose doctor has
gone on leave today (private.doctor_leave_refund_candidates, 0052) and
refunds each one through Razorpay + record_refund. Same
pg_try_advisory_xact_lock pattern app/routes/admin.py's retrain_once uses --
transaction-scoped, auto-releases on commit/rollback, safe across N
replicas with no manual unlock path."""

import asyncio

import asyncpg
import structlog

from app.payments.razorpay_client import RazorpayClient, RazorpayError

log = structlog.get_logger()


async def refund_doctor_leave_candidates_once(pool: asyncpg.Pool, client: RazorpayClient, lock_key: int) -> int:
    async with pool.acquire() as conn:
        async with conn.transaction():
            got_lock = await conn.fetchval("SELECT pg_try_advisory_xact_lock($1)", lock_key)
            if not got_lock:
                return 0

            candidates = await conn.fetch("SELECT * FROM doctor_leave_refund_candidates()")
            refunded = 0
            for row in candidates:
                if not row["razorpay_payment_id"]:
                    continue
                try:
                    refund = await client.create_refund(
                        razorpay_payment_id=row["razorpay_payment_id"],
                        amount_paise=row["amount_inr"] * 100,
                    )
                except RazorpayError as exc:
                    log.error(
                        "doctor_leave_refund_failed",
                        payment_id=str(row["payment_id"]),
                        status=exc.status_code,
                    )
                    continue

                updated = await conn.fetchrow(
                    "SELECT * FROM record_refund($1, $2, $3, $4)",
                    row["payment_id"], refund["id"], "doctor on leave", None,
                )
                # record_refund returns the SQL NULL payments composite on
                # rejection -- `SELECT * FROM fn()` unpacks that into one row
                # of all-NULL columns, not zero rows, so `is not None` alone
                # would count every rejection as a success.
                if updated is not None and updated["id"] is not None:
                    refunded += 1
                    log.info("doctor_leave_refund_issued", payment_id=str(row["payment_id"]))

            return refunded


async def doctor_leave_refund_loop(
    pool: asyncpg.Pool, client: RazorpayClient | None, lock_key: int, interval_seconds: int
) -> None:
    if client is None:
        # Same graceful-degrade shape as get_deepseek_client -- no key
        # configured, so this job just never runs instead of crashing.
        return
    while True:
        try:
            await refund_doctor_leave_candidates_once(pool, client, lock_key)
        except Exception:
            log.exception("doctor_leave_refund_loop_error")
        await asyncio.sleep(interval_seconds)
