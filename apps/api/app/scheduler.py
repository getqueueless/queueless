import asyncio

import asyncpg
import structlog

log = structlog.get_logger()


async def no_show_tick(pool: asyncpg.Pool, threshold_minutes: int, lock_key: int) -> list:
    """Transitions overdue 'called' tokens to 'no_show'.

    Safe across N replicas via two independent layers: pg_try_advisory_xact_lock
    (transaction-scoped -- auto-releases on commit/rollback, even if this
    process crashes mid-tick, so there's no manual unlock path and nothing to
    leak) stops concurrent replicas from racing the same tick, and the
    `WHERE status = 'called'` guard on the UPDATE makes re-running the tick a
    no-op on its own even without the lock, since rows that already left
    'called' just don't match any more.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            got_lock = await conn.fetchval("SELECT pg_try_advisory_xact_lock($1)", lock_key)
            if not got_lock:
                return []
            rows = await conn.fetch(
                """
                UPDATE tokens
                SET status = 'no_show'
                WHERE status = 'called'
                  AND called_at < now() - make_interval(mins => $1)
                RETURNING id
                """,
                threshold_minutes,
            )
            return [row["id"] for row in rows]


async def scheduler_loop(pool: asyncpg.Pool, threshold_minutes: int, lock_key: int, interval_seconds: int) -> None:
    while True:
        try:
            transitioned = await no_show_tick(pool, threshold_minutes, lock_key)
            if transitioned:
                log.info("no_show_tick_transitioned", count=len(transitioned))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad tick must not kill the loop
            log.warning("no_show_tick_error", error=str(exc))
        await asyncio.sleep(interval_seconds)
