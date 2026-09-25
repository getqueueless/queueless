"""app.analytics.call_analytics is the ONLY path DeepSeek's tool-calling can
reach a database function through. org_id is always the caller's own,
server-looked-up id -- never a param the caller/model supplies -- and any
function name or param outside ANALYTICS_FUNCTIONS must be rejected before
anything resembling a query executes."""

import uuid
from datetime import date, timedelta

import pytest

from app.analytics import (
    ANALYTICS_FUNCTIONS,
    InvalidAnalyticsParamsError,
    UnknownAnalyticsFunctionError,
    _parse_date,
    call_analytics,
)


async def _seed_token(db_pool, org_id, service_id, day, status="done", counter_id=None):
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, service_day, status, counter_id, created_at, called_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
        uuid.uuid4(), org_id, service_id, day, status, counter_id,
    )


def test_parse_date_resolves_relative_words():
    # Real bug, found live in prod (round 2 judging day): DeepSeek has no
    # notion of "today" and sometimes passes the literal word instead of
    # resolving it -- date.fromisoformat("today") raised, turning every
    # "... today" question into a hard invalid_tool_arguments error.
    today = date.today()
    assert _parse_date("today") == today
    assert _parse_date("yesterday") == today - timedelta(days=1)
    assert _parse_date("tomorrow") == today + timedelta(days=1)


def test_parse_date_still_rejects_real_garbage():
    with pytest.raises(InvalidAnalyticsParamsError):
        _parse_date("not a date at all")


async def test_rejects_unknown_function_name(db_pool):
    with pytest.raises(UnknownAnalyticsFunctionError):
        await call_analytics(db_pool, uuid.uuid4(), "drop_all_tables", {})


async def test_rejects_unexpected_param(db_pool):
    with pytest.raises(InvalidAnalyticsParamsError):
        await call_analytics(
            db_pool, uuid.uuid4(), "no_shows_by_service",
            {"day": "2026-01-01", "org_id": str(uuid.uuid4())},
        )


async def test_rejects_missing_param(db_pool):
    with pytest.raises(InvalidAnalyticsParamsError):
        await call_analytics(db_pool, uuid.uuid4(), "no_shows_by_service", {})


async def test_rejects_malformed_date(db_pool):
    with pytest.raises(InvalidAnalyticsParamsError):
        await call_analytics(
            db_pool, uuid.uuid4(), "no_shows_by_service", {"day": "not-a-date"}
        )


async def test_no_shows_by_service_real_query(db_pool):
    org_id = uuid.uuid4()
    service_id = uuid.uuid4()
    today = date.today()
    await _seed_token(db_pool, org_id, service_id, today, status="no_show")
    await _seed_token(db_pool, org_id, service_id, today, status="done")

    rows = await call_analytics(
        db_pool, org_id, "no_shows_by_service", {"day": today.isoformat()}
    )
    assert len(rows) == 1
    assert rows[0]["no_show_count"] == 1
    assert rows[0]["total_count"] == 2


async def test_org_scoping_cannot_be_overridden_by_param(db_pool):
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    service_id = uuid.uuid4()
    today = date.today()
    await _seed_token(db_pool, org_b, service_id, today, status="no_show")

    # org_id is a positional arg to call_analytics, not something params can
    # smuggle in (test_rejects_unexpected_param already proves the "org_id"
    # key is rejected) -- calling with org_a's real id must never see org_b's row.
    rows = await call_analytics(db_pool, org_a, "no_shows_by_service", {"day": today.isoformat()})
    assert rows == []


def test_every_whitelisted_function_has_no_org_id_param():
    for fn in ANALYTICS_FUNCTIONS.values():
        assert "org_id" not in fn.params, f"{fn.name} must not expose org_id as a client param"


async def test_service_time_trend_rejects_bad_uuid(db_pool):
    with pytest.raises(InvalidAnalyticsParamsError):
        await call_analytics(
            db_pool, uuid.uuid4(), "service_time_trend",
            {"service_id": "not-a-uuid", "days": 7},
        )


async def test_doctor_service_time_real_query(db_pool):
    from datetime import datetime, timedelta, timezone

    org_id = uuid.uuid4()
    service_id = uuid.uuid4()
    doctor_id = uuid.uuid4()
    today = date.today()
    now = datetime.now(timezone.utc)
    ten_min = timedelta(minutes=10)
    await db_pool.execute(
        "INSERT INTO tokens (id, org_id, service_id, doctor_id, service_day, status, serving_at, finished_at) "
        "VALUES ($1, $2, $3, $4, $5, 'done', $6, $7)",
        uuid.uuid4(), org_id, service_id, doctor_id, today, now, now + ten_min,
    )

    rows = await call_analytics(db_pool, org_id, "doctor_service_time", {"doctor_id": str(doctor_id), "days": 30})
    assert len(rows) == 1
    assert rows[0]["sample_count"] == 1
    assert abs(rows[0]["avg_service_minutes"] - 10) < 0.01
