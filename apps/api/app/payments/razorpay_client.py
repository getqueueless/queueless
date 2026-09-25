"""Thin async wrapper around Razorpay's REST API (Orders + Refunds only --
this codebase never touches card/UPI details directly, Razorpay's own
checkout.js collects those). Mirrors app/ai_client.py's shape: a factory
that returns None when unconfigured, so every caller degrades to a clear
503 instead of crashing the app at startup.

The key secret is NEVER logged -- read once from Settings and handed
straight to httpx's auth tuple. No function here accepts or returns it."""

import httpx

from app.config import Settings


class RazorpayError(Exception):
    def __init__(self, status_code: int, body: str):
        super().__init__(f"razorpay {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class RazorpayClient:
    def __init__(self, key_id: str, key_secret: str, base_url: str, timeout_seconds: float):
        self._key_id = key_id
        self._client = httpx.AsyncClient(
            base_url=base_url,
            auth=(key_id, key_secret),
            timeout=timeout_seconds,
        )

    @property
    def key_id(self) -> str:
        return self._key_id

    async def create_order(self, amount_paise: int, currency: str, receipt: str) -> dict:
        response = await self._client.post(
            "/orders",
            json={
                "amount": amount_paise,
                "currency": currency,
                "receipt": receipt,
                # Auto-capture on successful authorization -- this app has no
                # separate "capture" step; confirm_payment treats a matching
                # signature as final.
                "payment_capture": 1,
            },
        )
        if response.status_code >= 400:
            raise RazorpayError(response.status_code, response.text)
        return response.json()

    async def create_refund(self, razorpay_payment_id: str, amount_paise: int) -> dict:
        response = await self._client.post(
            f"/payments/{razorpay_payment_id}/refund",
            json={"amount": amount_paise},
        )
        if response.status_code >= 400:
            raise RazorpayError(response.status_code, response.text)
        return response.json()

    async def aclose(self) -> None:
        await self._client.aclose()


def get_razorpay_client(settings: Settings) -> RazorpayClient | None:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        return None
    return RazorpayClient(
        key_id=settings.razorpay_key_id,
        key_secret=settings.razorpay_key_secret,
        base_url=settings.razorpay_base_url,
        timeout_seconds=settings.razorpay_timeout_seconds,
    )
