from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.ml_runtime import predict_with_fallback

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


@router.post("/predict")
async def predict(body: PredictIn, request: Request) -> dict:
    return predict_with_fallback(
        request.app.state.ml_model,
        request.app.state.ml_meta,
        body.service,
        body.hour,
        body.weekday,
        body.queue_len_ahead,
        body.counters_open,
    )
