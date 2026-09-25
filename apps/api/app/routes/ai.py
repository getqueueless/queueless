import json
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.ai_ask import answer_question
from app.auth import AuthedProfile, AuthedUser, require_org_role, require_role
from app.rate_limit import limiter
from app.summary import run_daily_summary
from app.translate import translate_text

router = APIRouter()


class AskIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    question: Annotated[str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)]


@limiter.limit("10/minute")
async def _ask_rate_limit(request: Request, response: Response) -> None:
    # Route-level dependency, not a decorator on the endpoint itself -- see
    # the matching comment in app/routes/predict.py: a decorator-based limit
    # only runs after FastAPI has resolved the route's other dependencies
    # (including auth), so it'd never fire against an unauthenticated flood.
    return None


@router.post("/admin/ask", dependencies=[Depends(_ask_rate_limit)])
async def admin_ask(
    request: Request,
    body: AskIn,
    profile: AuthedProfile = Depends(require_org_role("admin")),
) -> dict:
    client = request.app.state.deepseek_client
    if client is None:
        raise HTTPException(status_code=503, detail="ai_unavailable")

    settings = request.app.state.settings
    result = await answer_question(
        client,
        settings.deepseek_model,
        settings.deepseek_max_tokens,
        request.app.state.db_pool,
        profile.org_id,
        body.question,
    )
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])
    return result


class TranslateIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    text: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    target_lang: Literal["hi", "pa"]


@router.post("/translate")
async def translate_route(
    request: Request,
    body: TranslateIn,
    user: AuthedUser = Depends(require_role("staff", "admin")),
) -> dict:
    settings = request.app.state.settings
    translated = await translate_text(
        request.app.state.deepseek_client,
        settings.deepseek_model,
        settings.deepseek_max_tokens,
        settings.translate_cache_size,
        body.text,
        body.target_lang,
    )
    return {"translated": translated, "target_lang": body.target_lang}


class SummaryRunIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    # ISO date string, e.g. "2026-01-01". None (or omitted) means today.
    day: str | None = None


@router.post("/admin/summary/run")
async def admin_summary_run(
    request: Request,
    body: SummaryRunIn,
    profile: AuthedProfile = Depends(require_org_role("admin")),
) -> dict:
    try:
        target_day = date.fromisoformat(body.day) if body.day else date.today()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid day") from exc

    settings = request.app.state.settings
    return await run_daily_summary(
        request.app.state.db_pool,
        request.app.state.deepseek_client,
        settings.deepseek_model,
        settings.deepseek_max_tokens,
        profile.org_id,
        target_day,
    )


@router.get("/admin/summary")
async def admin_summary_get(
    request: Request,
    day: str | None = None,
    lang: str | None = None,
    profile: AuthedProfile = Depends(require_org_role("admin")),
) -> dict:
    try:
        target_day = date.fromisoformat(day) if day else date.today()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid day") from exc

    row = await request.app.state.db_pool.fetchrow(
        "SELECT report, ai_generated, aggregates FROM ops_summaries WHERE org_id = $1 AND day = $2",
        profile.org_id, target_day,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="no summary for that day")

    report = row["report"]
    if lang in ("hi", "pa"):
        settings = request.app.state.settings
        report = await translate_text(
            request.app.state.deepseek_client, settings.deepseek_model,
            settings.deepseek_max_tokens, settings.translate_cache_size, report, lang,
        )

    return {
        "org_id": str(profile.org_id),
        "day": target_day.isoformat(),
        "report": report,
        "ai_generated": row["ai_generated"],
        "aggregates": json.loads(row["aggregates"]),
    }
