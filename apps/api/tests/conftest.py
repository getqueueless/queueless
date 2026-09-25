import asyncio
import os
import time
import uuid

os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:55432/postgres")
os.environ.setdefault(
    "DATABASE_URL_DIRECT", "postgresql://postgres:postgres@localhost:55432/postgres"
)
os.environ.setdefault("CORS_ALLOW_ORIGINS", '["http://localhost:3000"]')

import asyncpg
import jwt
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from scripts import dev_db

TEST_JWT_SECRET = "test-secret"


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
        await conn.execute("TRUNCATE profiles, tokens, push_tokens, token_notifications")
    finally:
        await conn.close()
    yield


@pytest_asyncio.fixture
async def db_pool(postgres):
    pool = await asyncpg.create_pool(dev_db.DATABASE_URL, min_size=1, max_size=5)
    yield pool
    await pool.close()


@pytest.fixture
def client(postgres):
    from app.main import app

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
