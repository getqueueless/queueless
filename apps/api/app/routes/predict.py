from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.ml_runtime import predict_with_fallback
from app.rate_limit import limiter

router = APIRouter()

# Must match scripts/generate_training_data.py's BASE_MINUTES keys -- the
# fixed 5-service Hospital OPD demo preset.
Service = Literal["general_opd", "pediatrics", "ortho", "dental", "eye"]


class PredictIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    service: Service
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
    return predict_with_fallback(
        request.app.state.ml_model,
        request.app.state.ml_meta,
        body.service,
        body.hour,
        body.weekday,
        body.queue_len_ahead,
        body.counters_open,
    )
