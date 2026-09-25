from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.ai_ask import answer_question
from app.auth import AuthedProfile, require_org_role
from app.rate_limit import limiter

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
