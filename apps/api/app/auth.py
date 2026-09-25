import time
from dataclasses import dataclass
from uuid import UUID

import asyncpg
import jwt
from fastapi import Depends, HTTPException, Request

from app.config import Settings


@dataclass(frozen=True)
class AuthedUser:
    user_id: UUID


def decode_token(token: str, settings: Settings) -> dict:
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["exp", "sub", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid token") from exc


def _get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_current_user(
    request: Request, settings: Settings = Depends(_get_settings)
) -> AuthedUser:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    payload = decode_token(token, settings)
    try:
        return AuthedUser(user_id=UUID(str(payload["sub"])))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="invalid subject claim") from exc


# In-process TTL cache for the authoritative app role. This is the ceiling on
# how fast a revoked staff member is actually locked out -- not instant.
_ROLE_CACHE: dict[UUID, tuple[str, float]] = {}


async def get_role(pool: asyncpg.Pool, user_id: UUID, ttl_seconds: float) -> str | None:
    cached = _ROLE_CACHE.get(user_id)
    now = time.monotonic()
    if cached is not None and cached[1] > now:
        return cached[0]
    role = await pool.fetchval("SELECT role FROM profiles WHERE user_id = $1", user_id)
    if role is not None:
        _ROLE_CACHE[user_id] = (role, now + ttl_seconds)
    return role


def require_role(*allowed: str):
    async def dependency(
        request: Request,
        user: AuthedUser = Depends(get_current_user),
        settings: Settings = Depends(_get_settings),
    ) -> AuthedUser:
        role = await get_role(request.app.state.db_pool, user.user_id, settings.role_cache_ttl_seconds)
        if role not in allowed:
            raise HTTPException(status_code=403, detail="forbidden")
        return user

    return dependency
