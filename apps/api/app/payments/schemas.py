from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator


class _ExactlyOneTarget(BaseModel):
    """Every hold is either a walk-in token or a booked appointment, never both -- same
    constraint the DB enforces on payments.token_id/appointment_id (0056)."""

    token_id: UUID | None = None
    appointment_id: UUID | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "_ExactlyOneTarget":
        if (self.token_id is None) == (self.appointment_id is None):
            raise ValueError("exactly one of token_id or appointment_id is required")
        return self


class OrderRequest(_ExactlyOneTarget):
    model_config = ConfigDict(extra="forbid")


class OrderResponse(BaseModel):
    order_id: str
    amount_inr: int
    currency: str
    key_id: str
    token_id: UUID | None = None
    appointment_id: UUID | None = None


class VerifyRequest(_ExactlyOneTarget):
    model_config = ConfigDict(extra="forbid")
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class VerifyResponse(BaseModel):
    status: str
    token_status: str | None = None
    appointment_status: str | None = None


class AdminRefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payment_id: UUID
    reason: str
