"""retrain_once -- called directly (not through HTTP) so its completion can
be awaited deterministically. Idempotent + safe across N replicas via the
same pg_try_advisory_xact_lock pattern app/scheduler.py used before the
delivery-only refactor deleted that file."""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from scripts.generate_training_data import SERVICE_IDS

GENERAL_OPD = uuid.UUID(SERVICE_IDS["General OPD"])
ORTHO = uuid.UUID(SERVICE_IDS["Orthopedics"])
COUNTER_A = uuid.uuid4()
COUNTER_B = uuid.uuid4()


async def _seed_called_tokens(db_pool, n: int, start_number: int = 1):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = []
    for i in range(n):
        created_at = base + timedelta(days=i % 90, hours=(i * 7) % 24, minutes=i % 60)
        wait = timedelta(minutes=3 + (i % 40))
        service_id = GENERAL_OPD if i % 3 else ORTHO
        rows.append(
            (
                uuid.uuid4(),
                service_id,
                created_at,
                created_at + wait,
                start_number + (i % 30),
                COUNTER_A if i % 2 else COUNTER_B,
                "done",
            )
        )
    await db_pool.executemany(
        "INSERT INTO tokens (id, service_id, created_at, called_at, number, counter_id, status) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        rows,
    )


async def test_retrain_refuses_below_threshold(db_pool):
    from app.routes.admin import retrain_once

    await _seed_called_tokens(db_pool, n=10)

    class _FakeApp:
        class state:
            ml_model = None
            ml_meta = {"version": 1}

    result = await retrain_once(_FakeApp(), db_pool, lock_key=555_000_001, min_real_rows=500, admin_user_id=uuid.uuid4())

    assert result["status"] == "insufficient_real_data"
    assert result["rows_found"] == 10
    assert result["rows_required"] == 500
    assert _FakeApp.state.ml_meta == {"version": 1}  # unchanged


async def test_retrain_succeeds_swaps_model_and_bumps_version(db_pool, tmp_path, monkeypatch):
    from app.routes import admin as admin_module

    monkeypatch.setattr(admin_module, "ML_DIR", tmp_path)
    (tmp_path / "model_meta.json").write_text(json.dumps({"version": 3}))

    await _seed_called_tokens(db_pool, n=520)

    class _FakeApp:
        class state:
            ml_model = None
            ml_meta = None

    result = await admin_module.retrain_once(
        _FakeApp(), db_pool, lock_key=555_000_002, min_real_rows=500, admin_user_id=uuid.uuid4()
    )

    assert result["status"] == "retrained"
    assert result["version"] == 4
    assert result["trained_on"] == "real"
    assert _FakeApp.state.ml_model is not None
    assert _FakeApp.state.ml_meta["version"] == 4
    assert (tmp_path / "wait_time_model.joblib").exists()
    written_meta = json.loads((tmp_path / "model_meta.json").read_text())
    assert written_meta["version"] == 4


async def test_retrain_concurrent_calls_only_one_retrains(db_pool, tmp_path, monkeypatch):
    from app.routes import admin as admin_module

    monkeypatch.setattr(admin_module, "ML_DIR", tmp_path)
    (tmp_path / "model_meta.json").write_text(json.dumps({"version": 1}))

    await _seed_called_tokens(db_pool, n=520)

    class _FakeApp:
        class state:
            ml_model = None
            ml_meta = None

    results = await asyncio.gather(
        admin_module.retrain_once(_FakeApp(), db_pool, lock_key=555_000_003, min_real_rows=500, admin_user_id=uuid.uuid4()),
        admin_module.retrain_once(_FakeApp(), db_pool, lock_key=555_000_003, min_real_rows=500, admin_user_id=uuid.uuid4()),
    )
    statuses = sorted(r["status"] for r in results)
    assert statuses == ["already_running", "retrained"]


async def test_retrain_writes_audit_via_write_audit_rpc(db_pool, tmp_path, monkeypatch):
    """Real migration 0036 added private.write_audit() as the one narrow
    door queueless_api can log through (no direct INSERT grant on
    audit_log). retrain_once must use it, not a raw INSERT that can no
    longer work in prod."""
    from app.routes import admin as admin_module

    monkeypatch.setattr(admin_module, "ML_DIR", tmp_path)
    (tmp_path / "model_meta.json").write_text('{"version": 1}')

    await _seed_called_tokens(db_pool, n=520)
    admin_id = uuid.uuid4()

    class _FakeApp:
        class state:
            ml_model = None
            ml_meta = None

    result = await admin_module.retrain_once(
        _FakeApp(), db_pool, lock_key=555_000_004, min_real_rows=500, admin_user_id=admin_id
    )
    assert result["status"] == "retrained"

    row = await db_pool.fetchrow(
        "SELECT entity, action, new FROM audit_log WHERE entity = 'ml_model' AND action = 'retrain'"
    )
    assert row is not None
    assert json.loads(row["new"])["triggered_by"] == str(admin_id)
