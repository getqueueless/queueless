from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.ml_runtime import predict_with_fallback
from app.rate_limit import limiter
from app.ttl_cache import TTLCache

router = APIRouter()


class PredictIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    # strict=False only here: JSON has no native UUID type, so a
    # model-wide-strict UUID field can never be satisfied by any JSON body --
    # this still requires a syntactically valid UUID string, it just allows
    # the str->UUID parse. Every other field stays fully strict (no numeric
    # coercion, no extra fields).
    service_id: Annotated[UUID, Field(strict=False)]
    # No existence check against a `doctors` table anywhere below: apps/api's
    # DB role has no grant on it (supabase/migrations/0038 only granted
    # anon/authenticated). A doctor_id for a doctor the model has no/too-
    # little data for degrades to the service-level prediction, same as any
    # other cold-start case -- see app/ml_runtime.py::predict_with_fallback.
    doctor_id: Annotated[UUID | None, Field(strict=False)] = None
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
    # validated against board_services rather than the services table. No
    # `day` filter: this only needs to prove the id is a real service, not
    # that it has today's row -- a `day = current_date` filter compared
    # Postgres-session-UTC against callers' local dates for no benefit (this
    # bit us locally: dev_db.py seeds with Python's date.today(), which is
    # Asia/Kolkata here, off by a day from UTC current_date near midnight
    # IST), and in prod migration 0030_rls_public_tables.sql's RLS policy on
    # board_services only names `anon, authenticated` -- not queueless_api --
    # so a day-scoped row lookup was silently RLS-filtered to zero rows
    # regardless of the date bug. See docs/DECISIONS.md for the grant fix
    # that's still needed on the DB side; this query is correct once granted.
    # Short-TTL cache: only successful predictions are cached (never a 404),
    # so a service_id that starts existing moments after a cached miss is
    # never masked by a stale "not found" -- the worst case is a slightly
    # stale wait estimate for a real service, exactly the tradeoff a short
    # TTL is meant to make.
    cache_key = (
        str(body.service_id), str(body.doctor_id), body.hour, body.weekday,
        body.queue_len_ahead, body.counters_open,
    )
    cached = request.app.state.predict_cache.get(cache_key)
    if cached is not None:
        return cached

    exists = await request.app.state.db_pool.fetchval(
        "SELECT 1 FROM board_services WHERE service_id = $1",
        body.service_id,
    )
    if not exists:
        raise HTTPException(status_code=404, detail="unknown service_id")

    result = predict_with_fallback(
        request.app.state.ml_model,
        request.app.state.ml_meta,
        str(body.service_id),
        body.hour,
        body.weekday,
        body.queue_len_ahead,
        body.counters_open,
        doctor_id=str(body.doctor_id) if body.doctor_id else None,
    )
    request.app.state.predict_cache.set(cache_key, result)
    return result
