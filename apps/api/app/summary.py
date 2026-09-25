"""Daily ops summary: aggregates via app.analytics's whitelisted functions
(so it's the same trusted, org-scoped, no-raw-SQL path /admin/ask uses),
DeepSeek writes a short report from those aggregates only -- never given
patient names or any other PII, since every analytics.* function already
only returns grouped aggregates.

`ops_summaries` doesn't exist in supabase/migrations yet (see
docs/DECISIONS.md); every DB write/read here degrades gracefully via the
same UndefinedTableError/InsufficientPrivilegeError pattern every other
missing-grant gap in this codebase uses.
"""

import asyncio
import json
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg
import structlog

from app.analytics import call_analytics

log = structlog.get_logger()

_table_missing_logged = False

REPORT_SYSTEM_PROMPT = (
    "You are writing a short daily operations summary for hospital queue management "
    "staff, from real aggregated data only (peak hours, no-show counts by service, "
    "average wait by hour, tokens served per counter). Cover: peak hours, any notable "
    "no-show pattern, counter workload, and one concrete staffing suggestion. 4-6 "
    "sentences, plain language, no invented numbers -- use only what's in the data."
)


def compute_next_run_seconds(now: datetime, hour: int, tz_name: str) -> float:
    """Seconds until the next `hour:00` in `tz_name`. `now` must be
    timezone-aware. Returns exactly 24h (never 0) when `now` lands exactly
    on the target minute, so a loop calling this in sequence never fires
    twice for the same tick."""
    tz = ZoneInfo(tz_name)
    local_now = now.astimezone(tz)
    target = local_now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= local_now:
        target += timedelta(days=1)
    return (target - local_now).total_seconds()


async def _gather_aggregates(pool: asyncpg.Pool, org_id: UUID, day: date) -> dict:
    day_str = day.isoformat()
    return {
        "peak_hours": await call_analytics(pool, org_id, "peak_hours", {"day": day_str}),
        "no_shows_by_service": await call_analytics(pool, org_id, "no_shows_by_service", {"day": day_str}),
        "avg_wait_by_hour": await call_analytics(pool, org_id, "avg_wait_by_hour", {"day": day_str}),
        "busiest_counters": await call_analytics(pool, org_id, "busiest_counters", {"day": day_str}),
    }


async def _write_ops_summary(pool: asyncpg.Pool, org_id: UUID, day: date, report: str, ai_generated: bool, aggregates: dict) -> None:
    global _table_missing_logged
    try:
        await pool.execute(
            "INSERT INTO ops_summaries (org_id, day, report, ai_generated, aggregates) "
            "VALUES ($1, $2, $3, $4, $5::jsonb) "
            "ON CONFLICT (org_id, day) DO UPDATE SET "
            "report = excluded.report, ai_generated = excluded.ai_generated, "
            "aggregates = excluded.aggregates, created_at = now()",
            org_id, day, report, ai_generated, json.dumps(aggregates, default=str),
        )
    except (asyncpg.exceptions.UndefinedTableError, asyncpg.exceptions.InsufficientPrivilegeError) as exc:
        if not _table_missing_logged:
            log.warning(
                "ops_summaries_table_missing",
                note="CREATE TABLE public.ops_summaries + GRANT for queueless_api needed -- see docs/DECISIONS.md",
                error=str(exc),
            )
            _table_missing_logged = True


async def run_daily_summary(pool: asyncpg.Pool, client, model: str, max_tokens: int, org_id: UUID, day: date) -> dict:
    """Runs even when DeepSeek is unavailable: the real aggregates are still
    written, with a plain (non-AI) fallback report noting that. A daily job
    must never silently produce nothing just because an LLM call failed."""
    aggregates = await _gather_aggregates(pool, org_id, day)

    ai_generated = False
    report = "AI summary unavailable. Raw aggregates recorded below."
    if client is not None:
        try:
            response = await client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": REPORT_SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(aggregates, default=str)},
                ],
            )
            text = response.choices[0].message.content
            if text:
                report = text
                ai_generated = True
        except Exception as exc:  # noqa: BLE001 - daily job must not die on an LLM failure
            log.warning("daily_summary_ai_failed", org_id=str(org_id), day=str(day), error=str(exc))

    await _write_ops_summary(pool, org_id, day, report, ai_generated, aggregates)
    return {"org_id": str(org_id), "day": day.isoformat(), "report": report, "ai_generated": ai_generated, "aggregates": aggregates}


async def run_daily_summary_all_orgs(pool: asyncpg.Pool, client, model: str, max_tokens: int, day: date, lock_key: int) -> list[dict]:
    """Advisory-locked for the whole tick (not per-org): a second replica
    running the same tick concurrently gets nothing to do rather than
    duplicating every org's summary and every org's DeepSeek call."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            got_lock = await conn.fetchval("SELECT pg_try_advisory_xact_lock($1)", lock_key)
            if not got_lock:
                return []

            org_rows = await conn.fetch(
                "SELECT DISTINCT org_id FROM tokens WHERE service_day = $1 AND org_id IS NOT NULL", day
            )
            results = []
            for row in org_rows:
                results.append(await run_daily_summary(pool, client, model, max_tokens, row["org_id"], day))
            return results


async def daily_summary_loop(pool: asyncpg.Pool, client, model: str, max_tokens: int, hour: int, tz_name: str, lock_key: int) -> None:
    while True:
        try:
            seconds = compute_next_run_seconds(datetime.now(tz=ZoneInfo("UTC")), hour, tz_name)
            await asyncio.sleep(seconds)
            today = datetime.now(tz=ZoneInfo(tz_name)).date()
            summaries = await run_daily_summary_all_orgs(pool, client, model, max_tokens, today, lock_key)
            if summaries:
                log.info("daily_summary_completed", org_count=len(summaries), day=str(today))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad night must not kill the loop
            log.warning("daily_summary_loop_error", error=str(exc))
            await asyncio.sleep(60)
