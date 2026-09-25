import asyncio
import os
import time
import uuid

TEST_JWT_SECRET = "test-secret-at-least-32-bytes-long-xxxx"
os.environ.setdefault("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:55432/postgres")
os.environ.setdefault(
    "DATABASE_URL_DIRECT", "postgresql://postgres:postgres@localhost:55432/postgres"
)
os.environ.setdefault("CORS_ALLOW_ORIGINS", '["http://localhost:3000"]')

import asyncpg
import jwt
import pytest
import pytest_asyncio
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from scripts import dev_db


@pytest.fixture(scope="session", autouse=True)
def postgres():
    dev_db.start_container()
    asyncio.run(dev_db.wait_ready())
    asyncio.run(dev_db.apply_schema())
    yield
    dev_db.stop_container()


@pytest_asyncio.fixture(autouse=True)
async def clean_tables(postgres):
    conn = await asyncpg.connect(dev_db.DATABASE_URL)
    try:
        await conn.execute(
            "TRUNCATE profiles, services, board_services, tokens, push_tokens, "
            "notifications, audit_log"
        )
    finally:
        await conn.close()
    yield


@pytest_asyncio.fixture
async def db_pool(postgres):
    pool = await asyncpg.create_pool(dev_db.DATABASE_URL, min_size=1, max_size=5)
    yield pool
    await pool.close()


from app.auth import get_current_user, require_org_role, require_role  # noqa: E402

test_router = APIRouter()


@test_router.get("/_test/identity")
async def _identity(user=Depends(get_current_user)):
    return {"user_id": str(user.user_id)}


@test_router.get("/_test/staff-only")
async def _staff_only(user=Depends(require_role("staff", "admin"))):
    return {"user_id": str(user.user_id)}


@test_router.get("/_test/org-scoped")
async def _org_scoped(profile=Depends(require_org_role("staff", "admin"))):
    return {"user_id": str(profile.user_id), "org_id": str(profile.org_id)}


_test_router_included = False


@pytest.fixture
def client(postgres):
    global _test_router_included
    from app.main import app
    from app.rate_limit import limiter

    limiter.reset()
    if not _test_router_included:
        app.include_router(test_router)
        _test_router_included = True
    with TestClient(app) as c:
        yield c


def make_token(sub: str | None = None, secret: str = TEST_JWT_SECRET, **overrides) -> str:
    payload = {
        "sub": sub or str(uuid.uuid4()),
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
        "role": "authenticated",
    }
    payload.update(overrides)
    return jwt.encode(payload, secret, algorithm="HS256")
