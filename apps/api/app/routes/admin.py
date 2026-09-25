import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import asyncpg
import joblib
import pandas as pd
import structlog
from fastapi import APIRouter, Depends, Request, Response

from app.auth import AuthedUser, require_role
from app.metrics import retrain_duration_seconds, retrain_last_success
from app.rate_limit import limiter
from scripts.generate_training_data import SERVICES
from scripts.train_core import read_previous_version, train_and_evaluate

router = APIRouter()
log = structlog.get_logger()

ML_DIR = Path(__file__).resolve().parent.parent.parent / "ml"

FEATURE_COLUMNS = ["service", "hour", "weekday", "queue_len_ahead", "counters_open"]
TARGET_COLUMN = "wait_minutes"

_MODEL_REPORT_FIELDS = (
    "version",
    "trained_at",
    "trained_on",
    "mae_model",
    "mae_baseline",
    "split_method",
    "n_rows",
    "mae_model_by_service",
)


@router.get("/admin/model")
async def get_model_report(
    request: Request, user: AuthedUser = Depends(require_role("admin"))
) -> dict:
    # A model is process-wide, not per-org, so a plain role check (not
    # require_org_role) is enough here -- there's no org-scoped data to leak.
    meta = request.app.state.ml_meta
    return {field: meta.get(field) for field in _MODEL_REPORT_FIELDS}


def _rows_to_training_frame(rows: list[asyncpg.Record], service_categories: list[str]) -> pd.DataFrame:
    """Derives the same feature shape scripts/generate_training_data.py
    produces, from real tokens.

    queue_len_ahead: `number - 1`, clipped at 0. `number` is strictly
    sequential per (service_id, service_day) in the real schema -- a real,
    if imperfect (ignores priority-lane reordering), stand-in for "how many
    tokens were ahead."

    counters_open: no historical value exists in anything queueless_api can
    read (no grant on `counters`, and `board_services` has no open-counters
    column either). Proxy: distinct non-null counter_id actually used by
    that service on that calendar day, clipped at 1. ponytail: this
    undercounts a counter that opened but served nobody that day, and can't
    see a counter opened after retrain-time's snapshot for future rows --
    upgrade path is a real counters_audit replay (0025_remaining_audit_
    triggers.sql) if that ceiling ever matters.
    """
    df = pd.DataFrame(rows, columns=["service_id", "created_at", "called_at", "number", "counter_id"])
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    df["called_at"] = pd.to_datetime(df["called_at"], utc=True)

    calendar_date = df["created_at"].dt.date
    # Chronological ordinal, not first-appearance order: dates compare
    # naturally, so dense-rank over the date values IS the day sequence.
    df["day"] = calendar_date.rank(method="dense").astype(int) - 1

    counters_per_day = (
        df.assign(_date=calendar_date)
        .groupby(["service_id", "_date"])["counter_id"]
        .transform(lambda s: max(s.dropna().nunique(), 1))
    )
    df["counters_open"] = counters_per_day

    df["hour"] = df["created_at"].dt.hour
    # pandas .dt.dayofweek is Monday=0..Sunday=6, same convention
    # generate_training_data.py uses (weekday==0 gets the Monday
    # multiplier) -- no conversion needed since this is derived in pandas,
    # not via Postgres's 0=Sunday extract(dow).
    df["weekday"] = df["created_at"].dt.dayofweek.astype(int)
    df["queue_len_ahead"] = (df["number"] - 1).clip(lower=0)
    df["wait_minutes"] = (df["called_at"] - df["created_at"]).dt.total_seconds() / 60
    df["service"] = pd.Categorical(df["service_id"].astype(str), categories=service_categories)

    return df


def _write_model_atomically(model, meta: dict) -> int:
    """Reads the previous version, writes the new model + meta to temp
    paths, then os.replace()'s both onto the live path (atomic on POSIX
    same-filesystem renames -- a concurrent /predict request never sees a
    half-written file). All synchronous; call via asyncio.to_thread from
    async code, since this runs while retrain_once still holds the
    advisory lock + DB transaction, and blocking the event loop there
    would stall every other request on this worker for however long these
    writes take."""
    version = read_previous_version(ML_DIR / "model_meta.json") + 1
    meta["version"] = version

    ML_DIR.mkdir(exist_ok=True)
    tmp_model = ML_DIR / "wait_time_model.joblib.tmp"
    joblib.dump(model, tmp_model)
    os.replace(tmp_model, ML_DIR / "wait_time_model.joblib")

    tmp_meta = ML_DIR / "model_meta.json.tmp"
    with open(tmp_meta, "w") as f:
        json.dump(meta, f, indent=2)
    os.replace(tmp_meta, ML_DIR / "model_meta.json")

    return version


async def retrain_once(app, pool: asyncpg.Pool, lock_key: int, min_real_rows: int, admin_user_id: UUID) -> dict:
    """Idempotent, safe across N replicas: pg_try_advisory_xact_lock is
    transaction-scoped and auto-releases on commit/rollback (even on a mid-
    retrain crash), so there's no manual unlock path and nothing to leak.
    app/scheduler.py used this exact pattern before the delivery-only
    refactor deleted that file -- rewritten here fresh with a distinct lock
    key (lock keys share one global keyspace per Postgres instance)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            got_lock = await conn.fetchval("SELECT pg_try_advisory_xact_lock($1)", lock_key)
            if not got_lock:
                return {"status": "already_running"}

            rows = await conn.fetch(
                "SELECT service_id, created_at, called_at, number, counter_id "
                "FROM tokens WHERE called_at IS NOT NULL"
            )
            if len(rows) < min_real_rows:
                return {
                    "status": "insufficient_real_data",
                    "rows_found": len(rows),
                    "rows_required": min_real_rows,
                }

            # Gauges, not a histogram: an ops dashboard/alert wants "did the
            # most recent retrain succeed, how long did it take", not a
            # distribution -- retrains are rare (rate-limited to 1/10min,
            # meant to be occasional) so a Gauge is the right shape here.
            started = time.monotonic()
            try:
                df = _rows_to_training_frame(rows, SERVICES)
                model, meta = await asyncio.to_thread(
                    train_and_evaluate, df, FEATURE_COLUMNS, TARGET_COLUMN, SERVICES
                )
                meta["trained_on"] = "real"
                meta["trained_at"] = datetime.now(timezone.utc).isoformat()

                # All synchronous file I/O (version read, model dump, atomic
                # replace x2) in one asyncio.to_thread call -- this runs
                # while holding the advisory lock + DB transaction, so
                # blocking the event loop here would stall every other
                # request on this worker for however long the writes take,
                # not just this one.
                meta["version"] = await asyncio.to_thread(_write_model_atomically, model, meta)
            except Exception:
                retrain_last_success.set(0)
                retrain_duration_seconds.set(time.monotonic() - started)
                raise
            retrain_last_success.set(1)
            retrain_duration_seconds.set(time.monotonic() - started)

            app.state.ml_model, app.state.ml_meta = model, meta

            try:
                # queueless_api still has no direct INSERT grant on
                # audit_log (by design, stays fully locked down) -- real
                # migration 0036 added private.write_audit() as the one
                # narrow, safe door for apps/api to log through instead.
                # actor is left implicit/unset here (write_audit's own
                # signature has no actor param -- housekeeping's own
                # cron-originated rows work the same way, queueless_api
                # isn't a signed-in user); admin_user_id is folded into
                # `new` instead so it's still recorded.
                await conn.execute(
                    "SELECT private.write_audit($1, $2, $3, $4, $5, $6::jsonb)",
                    None, "ml_model", None, "retrain", None,
                    json.dumps({**meta, "triggered_by": str(admin_user_id)}),
                )
            except (asyncpg.exceptions.UndefinedFunctionError, asyncpg.InsufficientPrivilegeError) as exc:
                # Graceful fallback if this runs against an environment that
                # hasn't picked up migration 0036 yet -- the retrain itself
                # already succeeded (model swapped above); don't fail the
                # request over an audit trail it can't write yet.
                log.warning("retrain_audit_write_failed", error=str(exc))

            return {"status": "retrained", **meta}


@limiter.limit("1/10minutes")
async def _retrain_rate_limit(request: Request, response: Response) -> None:
    # Route-level dependency, not a decorator on the endpoint itself -- see
    # the matching comment in app/routes/predict.py: a decorator-based limit
    # only runs after FastAPI has resolved the route's other dependencies
    # (including auth), so it'd never fire against an unauthenticated flood.
    return None


@router.post("/admin/retrain", status_code=202, dependencies=[Depends(_retrain_rate_limit)])
async def start_retrain(request: Request, user: AuthedUser = Depends(require_role("admin"))) -> dict:
    settings = request.app.state.settings
    asyncio.create_task(
        retrain_once(
            request.app,
            request.app.state.db_pool,
            settings.retrain_lock_key,
            settings.retrain_min_real_rows,
            user.user_id,
        )
    )
    return {"status": "started"}
