from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token_id: UUID


class OrderResponse(BaseModel):
    order_id: str
    amount_inr: int
    currency: str
    key_id: str
    token_id: UUID


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token_id: UUID
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class VerifyResponse(BaseModel):
    status: str
    token_status: str


class AdminRefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payment_id: UUID
    reason: str
