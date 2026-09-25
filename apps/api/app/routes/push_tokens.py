from fastapi import APIRouter, Depends, Request, Response

from app.auth import AuthedUser, get_current_user
from app.notifications import PushTokenIn, upsert_push_token
from app.rate_limit import limiter

router = APIRouter()


@limiter.limit("5/minute")
async def _push_tokens_rate_limit(request: Request, response: Response) -> None:
    """A route-level `dependencies=[...]` entry, not a body param -- FastAPI
    resolves route-level dependencies before the endpoint's own Depends()
    parameters, so this runs (and can 429) before get_current_user does.
    Applying @limiter.limit directly to the endpoint itself would silently
    never fire on an auth failure, since the decorated function body -- where
    slowapi's check lives -- only runs after dependencies resolve."""
    return None


@router.post(
    "/push-tokens", status_code=204, dependencies=[Depends(_push_tokens_rate_limit)]
)
async def register_push_token(
    request: Request,
    body: PushTokenIn,
    user: AuthedUser = Depends(get_current_user),
) -> None:
    await upsert_push_token(request.app.state.db_pool, user.user_id, body.device_id, body.token)
