"""Razorpay's two HMAC-SHA256 schemes, both constant-time compared:

- checkout.js hands back order_id + payment_id + signature after a successful
  payment; the signature is over "order_id|payment_id", keyed by the account's
  key SECRET (not the webhook secret -- a different key from the same dashboard).
- The webhook signs the raw request body, keyed by the separately configured
  webhook secret. Verifying it needs the exact bytes Razorpay sent, before any
  JSON parsing -- see routes.py, which reads request.body() for this reason.
"""

import hashlib
import hmac


def verify_payment_signature(order_id: str, payment_id: str, signature: str, key_secret: str) -> bool:
    expected = hmac.new(
        key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(raw_body: bytes, signature: str, webhook_secret: str) -> bool:
    expected = hmac.new(webhook_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
