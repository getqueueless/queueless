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


@dataclass(frozen=True)
class AuthedProfile:
    user_id: UUID
    role: str
    org_id: UUID | None


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


# In-process TTL cache for the authoritative app role + org. This is the
# ceiling on how fast a revoked staff member is actually locked out -- not
# instant. Role and org_id are cached together, one lookup, one cache: an
# org-scoped route and a role-only route must never see different data.
_PROFILE_CACHE: dict[UUID, tuple[str, UUID | None, float]] = {}


async def get_profile(pool: asyncpg.Pool, user_id: UUID, ttl_seconds: float) -> AuthedProfile | None:
    cached = _PROFILE_CACHE.get(user_id)
    now = time.monotonic()
    if cached is not None and cached[2] > now:
        role, org_id, _ = cached
        return AuthedProfile(user_id=user_id, role=role, org_id=org_id)
    # profiles.id is the PK (references auth.users.id directly) -- there is no
    # profiles.user_id column in the real schema (supabase/migrations/0002).
    row = await pool.fetchrow("SELECT role, org_id FROM profiles WHERE id = $1", user_id)
    if row is None:
        return None
    _PROFILE_CACHE[user_id] = (row["role"], row["org_id"], now + ttl_seconds)
    return AuthedProfile(user_id=user_id, role=row["role"], org_id=row["org_id"])


async def get_role(pool: asyncpg.Pool, user_id: UUID, ttl_seconds: float) -> str | None:
    profile = await get_profile(pool, user_id, ttl_seconds)
    return profile.role if profile else None


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


def require_org_role(*allowed: str):
    """Like require_role, but returns the caller's AuthedProfile (with
    org_id) for routes that must scope their own query by it. Never accept
    an org_id from the client (path/query/body) for this purpose -- the
    server-looked-up org_id here is the only one any route may filter by."""

    async def dependency(
        request: Request,
        user: AuthedUser = Depends(get_current_user),
        settings: Settings = Depends(_get_settings),
    ) -> AuthedProfile:
        profile = await get_profile(request.app.state.db_pool, user.user_id, settings.role_cache_ttl_seconds)
        if profile is None or profile.role not in allowed:
            raise HTTPException(status_code=403, detail="forbidden")
        return profile

    return dependency
