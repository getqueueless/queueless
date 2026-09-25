"""run_daily_summary aggregates via the same trusted app.analytics path
/admin/ask uses (aggregates only -- no patient names ever reach DeepSeek),
degrades to a non-AI fallback report when DeepSeek is unavailable/fails
(a daily job must never produce nothing), and is idempotent per (org, day)."""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.summary import run_daily_summary, run_daily_summary_all_orgs


def _fake_client(text: str):
    client = SimpleNamespace()
    client.chat = SimpleNamespace()
    client.chat.completions = SimpleNamespace()
    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])
    client.chat.completions.create = AsyncMock(return_value=response)
    return client


async def _seed_token(db_pool, org_id, service_id, day, status="no_show"):
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, service_day, status, created_at, called_at) "
        "VALUES ($1, $2, $3, $4, $5, now(), now())",
        uuid.uuid4(), org_id, service_id, day, status,
    )


async def test_writes_ai_generated_report_and_aggregates(db_pool):
    org_id = uuid.uuid4()
    service_id = uuid.uuid4()
    today = date.today()
    await _seed_token(db_pool, org_id, service_id, today, status="no_show")

    client = _fake_client("Peak hour was mid-morning; one no-show recorded; staff normally.")
    result = await run_daily_summary(db_pool, client, "deepseek-chat", 300, org_id, today)

    assert result["ai_generated"] is True
    assert "no-show" in result["report"]
    assert result["aggregates"]["no_shows_by_service"][0]["no_show_count"] == 1

    row = await db_pool.fetchrow(
        "SELECT report, ai_generated FROM ops_summaries WHERE org_id = $1 AND day = $2", org_id, today
    )
    assert row is not None
    assert row["ai_generated"] is True


async def test_no_client_still_writes_fallback_report(db_pool):
    org_id = uuid.uuid4()
    service_id = uuid.uuid4()
    today = date.today()
    await _seed_token(db_pool, org_id, service_id, today, status="done")

    result = await run_daily_summary(db_pool, None, "deepseek-chat", 300, org_id, today)

    assert result["ai_generated"] is False
    row = await db_pool.fetchrow(
        "SELECT report, ai_generated FROM ops_summaries WHERE org_id = $1 AND day = $2", org_id, today
    )
    assert row is not None
    assert row["ai_generated"] is False


async def test_rerunning_same_day_upserts_not_duplicates(db_pool):
    org_id = uuid.uuid4()
    today = date.today()
    client = _fake_client("first")
    await run_daily_summary(db_pool, client, "deepseek-chat", 300, org_id, today)

    client2 = _fake_client("second")
    await run_daily_summary(db_pool, client2, "deepseek-chat", 300, org_id, today)

    count = await db_pool.fetchval(
        "SELECT count(*) FROM ops_summaries WHERE org_id = $1 AND day = $2", org_id, today
    )
    assert count == 1
    report = await db_pool.fetchval(
        "SELECT report FROM ops_summaries WHERE org_id = $1 AND day = $2", org_id, today
    )
    assert report == "second"


async def test_all_orgs_discovers_distinct_orgs_with_activity(db_pool):
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    today = date.today()
    await _seed_token(db_pool, org_a, uuid.uuid4(), today)
    await _seed_token(db_pool, org_b, uuid.uuid4(), today)

    client = _fake_client("ok")
    results = await run_daily_summary_all_orgs(db_pool, client, "deepseek-chat", 300, today, lock_key=999_111_222)

    result_orgs = {r["org_id"] for r in results}
    assert result_orgs == {str(org_a), str(org_b)}


async def test_all_orgs_concurrent_calls_only_one_runs(db_pool):
    import asyncio

    org_id = uuid.uuid4()
    today = date.today()
    await _seed_token(db_pool, org_id, uuid.uuid4(), today)

    client = _fake_client("ok")
    results = await asyncio.gather(
        run_daily_summary_all_orgs(db_pool, client, "deepseek-chat", 300, today, lock_key=999_111_223),
        run_daily_summary_all_orgs(db_pool, client, "deepseek-chat", 300, today, lock_key=999_111_223),
    )
    non_empty = [r for r in results if r]
    assert len(non_empty) == 1
