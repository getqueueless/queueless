from fastapi import APIRouter, Depends, Request

from app.auth import AuthedUser, get_current_user
from app.notifications import PushTokenIn, upsert_push_token

router = APIRouter()


@router.post("/push-tokens", status_code=204)
async def register_push_token(
    body: PushTokenIn,
    request: Request,
    user: AuthedUser = Depends(get_current_user),
) -> None:
    await upsert_push_token(request.app.state.db_pool, user.user_id, body.device_id, body.token)
