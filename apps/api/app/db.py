import asyncpg

from app.config import Settings


async def create_pool(settings: Settings) -> asyncpg.Pool:
    return await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)


async def get_direct_connection(settings: Settings) -> asyncpg.Connection:
    """A dedicated, non-pooled session connection. LISTEN requires a session
    connection, so this must bypass any transaction-mode PgBouncer in front
    of Postgres."""
    return await asyncpg.connect(settings.database_url_direct)


async def check_db(pool: asyncpg.Pool) -> bool:
    try:
        await pool.fetchval("SELECT 1")
        return True
    except Exception:
        return False
