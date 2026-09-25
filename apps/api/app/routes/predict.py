from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.ml_runtime import predict_with_fallback
from app.rate_limit import limiter

router = APIRouter()


class PredictIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    # strict=False only here: JSON has no native UUID type, so a
    # model-wide-strict UUID field can never be satisfied by any JSON body --
    # this still requires a syntactically valid UUID string, it just allows
    # the str->UUID parse. Every other field stays fully strict (no numeric
    # coercion, no extra fields).
    service_id: Annotated[UUID, Field(strict=False)]
    hour: Annotated[int, Field(ge=0, le=23)]
    weekday: Annotated[int, Field(ge=0, le=6)]
    queue_len_ahead: Annotated[int, Field(ge=0, le=500)]
    counters_open: Annotated[int, Field(ge=1, le=50)]


@limiter.limit("60/minute")
async def _predict_rate_limit(request: Request, response: Response) -> None:
    # Route-level dependency, not applied to the endpoint itself -- see the
    # matching comment in app/routes/push_tokens.py for why: a limit on the
    # endpoint's own function only runs after FastAPI has already parsed and
    # validated the request body, so a flood of invalid bodies would never
    # be counted.
    return None


@router.post("/predict", dependencies=[Depends(_predict_rate_limit)])
async def predict(request: Request, body: PredictIn) -> dict:
    # apps/api's DB role (queueless_api, supabase/migrations/0018) has SELECT
    # on board_services but not on services, so service_id existence is
    # validated against board_services -- which already carries
    # (service_id, day) as its primary key -- rather than the services table.
    exists = await request.app.state.db_pool.fetchval(
        "SELECT 1 FROM board_services WHERE service_id = $1 AND day = current_date",
        body.service_id,
    )
    if not exists:
        raise HTTPException(status_code=404, detail="unknown service_id for today")

    return predict_with_fallback(
        request.app.state.ml_model,
        request.app.state.ml_meta,
        str(body.service_id),
        body.hour,
        body.weekday,
        body.queue_len_ahead,
        body.counters_open,
    )
