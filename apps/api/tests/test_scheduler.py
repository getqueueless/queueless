import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from app.scheduler import no_show_tick

LOCK_KEY = 918_273_645


async def _seed_called_token(db_pool, minutes_ago: int) -> uuid.UUID:
    token_id = uuid.uuid4()
    called_at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    await db_pool.execute(
        "INSERT INTO tokens(id, service_id, status, patient_id, called_at) "
        "VALUES ($1, $2, 'called', $3, $4)",
        token_id,
        uuid.uuid4(),
        uuid.uuid4(),
        called_at,
    )
    return token_id


async def test_two_concurrent_ticks_exactly_one_wins(db_pool):
    token_id = await _seed_called_token(db_pool, minutes_ago=20)

    results = await asyncio.gather(
        no_show_tick(db_pool, 15, LOCK_KEY),
        no_show_tick(db_pool, 15, LOCK_KEY),
    )

    non_empty = [r for r in results if r]
    empty = [r for r in results if not r]
    assert len(non_empty) == 1, f"expected exactly one winner, got {results}"
    assert len(empty) == 1
    assert non_empty[0] == [token_id]


async def test_rerunning_tick_sequentially_is_a_no_op(db_pool):
    token_id = await _seed_called_token(db_pool, minutes_ago=20)

    first = await no_show_tick(db_pool, 15, LOCK_KEY)
    second = await no_show_tick(db_pool, 15, LOCK_KEY)

    assert first == [token_id]
    assert second == []


async def test_recently_called_token_not_transitioned(db_pool):
    await _seed_called_token(db_pool, minutes_ago=1)

    result = await no_show_tick(db_pool, 15, LOCK_KEY)

    assert result == []
