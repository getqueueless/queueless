"""The 8 read-only analytics.* database functions DeepSeek's tool-calling in
/admin/ask (and the daily ops summary) may call -- nothing else. The real
analytics.* functions don't exist in supabase/migrations yet as of this
writing (see docs/DECISIONS.md for the assumed signatures, and
scripts/dev_db.py for fixture versions real enough to test this module
against real Postgres).

Security invariants, both enforced here:
  1. org_id is NEVER a param a caller (model or HTTP client) supplies -- it
     is always the positional org_id of the caller's own server-side-looked-
     up profile, injected below. `test_every_whitelisted_function_has_no_
     org_id_param` (tests/test_analytics.py) guards against ever adding one
     to a function's param schema.
  2. `name` and every param key must match ANALYTICS_FUNCTIONS exactly --
     anything else raises before a query is built, let alone executed.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Callable
from uuid import UUID

import asyncpg


class UnknownAnalyticsFunctionError(Exception):
    pass


class InvalidAnalyticsParamsError(Exception):
    pass


def _parse_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise InvalidAnalyticsParamsError(f"not a valid date: {value!r}") from exc


def _parse_uuid(value: Any) -> UUID:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise InvalidAnalyticsParamsError(f"not a valid uuid: {value!r}") from exc


def _parse_int(value: Any) -> int:
    try:
        return int(value)
    except (ValueError, TypeError) as exc:
        raise InvalidAnalyticsParamsError(f"not a valid int: {value!r}") from exc


@dataclass(frozen=True)
class AnalyticsFunction:
    name: str
    description: str
    # ordered param-name -> parser/validator. Order here is the exact
    # positional order passed to the SQL function after org_id.
    params: dict[str, Callable[[Any], Any]]


ANALYTICS_FUNCTIONS: dict[str, AnalyticsFunction] = {
    "no_shows_by_service": AnalyticsFunction(
        name="no_shows_by_service",
        description="No-show counts per service for a given day (YYYY-MM-DD).",
        params={"day": _parse_date},
    ),
    "avg_wait_by_hour": AnalyticsFunction(
        name="avg_wait_by_hour",
        description="Average wait time in minutes by hour of day, for a given day.",
        params={"day": _parse_date},
    ),
    "busiest_counters": AnalyticsFunction(
        name="busiest_counters",
        description="Tokens served per counter for a given day.",
        params={"day": _parse_date},
    ),
    "tokens_per_day": AnalyticsFunction(
        name="tokens_per_day",
        description="Token volume per day across a date range.",
        params={"start_day": _parse_date, "end_day": _parse_date},
    ),
    "service_time_trend": AnalyticsFunction(
        name="service_time_trend",
        description="Average service time trend for one service over the last N days.",
        params={"service_id": _parse_uuid, "days": _parse_int},
    ),
    "wait_vs_predicted": AnalyticsFunction(
        name="wait_vs_predicted",
        description="Actual wait time per token for a given day.",
        params={"day": _parse_date},
    ),
    "peak_hours": AnalyticsFunction(
        name="peak_hours",
        description="Token volume by hour of day, for a given day.",
        params={"day": _parse_date},
    ),
    "lane_mix": AnalyticsFunction(
        name="lane_mix",
        description="Token counts by priority lane, for a given day.",
        params={"day": _parse_date},
    ),
}


async def call_analytics(
    pool: asyncpg.Pool, org_id: UUID, name: str, params: dict[str, Any]
) -> list[dict]:
    fn = ANALYTICS_FUNCTIONS.get(name)
    if fn is None:
        raise UnknownAnalyticsFunctionError(name)

    extra = set(params) - set(fn.params)
    if extra:
        raise InvalidAnalyticsParamsError(f"unexpected params for {name}: {sorted(extra)}")

    missing = set(fn.params) - set(params)
    if missing:
        raise InvalidAnalyticsParamsError(f"missing params for {name}: {sorted(missing)}")

    parsed_args = [org_id]
    for param_name, parser in fn.params.items():
        parsed_args.append(parser(params[param_name]))

    # `name` is interpolated into the SQL text below -- safe ONLY because it
    # was just resolved via ANALYTICS_FUNCTIONS.get(name) above (one of 8
    # fixed, hardcoded strings; anything else already raised). Postgres has
    # no parameter-binding syntax for identifiers (function/table/column
    # names), so this is the standard, correct pattern for a closed
    # whitelist -- never do this with anything not gated this way. Belt and
    # suspenders: assert the shape anyway so this stays obviously safe to a
    # reviewer even without re-deriving the whitelist argument.
    assert name.isidentifier() and name == fn.name
    placeholders = ", ".join(f"${i + 1}" for i in range(len(parsed_args)))
    query = f"SELECT * FROM analytics.{name}({placeholders})"

    rows = await pool.fetch(query, *parsed_args)
    return [dict(row) for row in rows]
