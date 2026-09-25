import uuid
from datetime import date

from scripts.generate_training_data import SERVICE_IDS

GENERAL_OPD_ID = SERVICE_IDS["General OPD"]


async def _seed_board_service(db_pool, service_id=GENERAL_OPD_ID, day=None):
    await db_pool.execute(
        "INSERT INTO board_services(service_id, day) VALUES ($1, $2) "
        "ON CONFLICT (service_id, day) DO NOTHING",
        uuid.UUID(service_id),
        day or date.today(),
    )


async def test_predict_returns_model_prediction_for_a_well_sampled_bucket(client, db_pool):
    await _seed_board_service(db_pool)
    resp = client.post(
        "/predict",
        json={
            "service_id": GENERAL_OPD_ID,
            "hour": 10,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["fallback"] is False
    assert body["reason"] is None
    assert body["predicted_wait_minutes"] > 0


async def test_predict_falls_back_for_sparse_bucket(client, db_pool):
    await _seed_board_service(db_pool)
    import app.main as main_module

    bucket_key = f"{GENERAL_OPD_ID}_10"
    original = main_module.app.state.ml_meta["bucket_counts"].get(bucket_key)
    main_module.app.state.ml_meta["bucket_counts"][bucket_key] = 3
    try:
        resp = client.post(
            "/predict",
            json={
                "service_id": GENERAL_OPD_ID,
                "hour": 10,
                "weekday": 2,
                "queue_len_ahead": 5,
                "counters_open": 2,
            },
        )
    finally:
        main_module.app.state.ml_meta["bucket_counts"][bucket_key] = original

    assert resp.status_code == 200
    body = resp.json()
    assert body["fallback"] is True
    assert body["reason"] == "sparse_training_data"


async def test_predict_rejects_malformed_service_id(client):
    resp = client.post(
        "/predict",
        json={
            "service_id": "not-a-uuid",
            "hour": 10,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 422


async def test_predict_rejects_unknown_service_id(client):
    resp = client.post(
        "/predict",
        json={
            "service_id": str(uuid.uuid4()),
            "hour": 10,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 404


async def test_predict_rejects_out_of_range_hour(client, db_pool):
    await _seed_board_service(db_pool)
    resp = client.post(
        "/predict",
        json={
            "service_id": GENERAL_OPD_ID,
            "hour": 24,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 422


async def test_predict_rejects_wrong_type(client, db_pool):
    await _seed_board_service(db_pool)
    resp = client.post(
        "/predict",
        json={
            "service_id": GENERAL_OPD_ID,
            "hour": "ten",
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 422


async def test_repeated_identical_request_hits_cache_not_db(client, db_pool):
    import app.main as main_module

    await _seed_board_service(db_pool)
    body = {
        "service_id": GENERAL_OPD_ID,
        "hour": 11,
        "weekday": 3,
        "queue_len_ahead": 2,
        "counters_open": 2,
    }

    calls = {"n": 0}

    class CountingPool:
        def __init__(self, real_pool):
            self._real = real_pool

        async def fetchval(self, *args, **kwargs):
            calls["n"] += 1
            return await self._real.fetchval(*args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._real, name)

    real_pool = main_module.app.state.db_pool
    main_module.app.state.db_pool = CountingPool(real_pool)
    try:
        first = client.post("/predict", json=body)
        second = client.post("/predict", json=body)
    finally:
        main_module.app.state.db_pool = real_pool

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert calls["n"] == 1, f"expected exactly 1 DB existence check (cache hit on 2nd), got {calls['n']}"


def test_predict_with_fallback_uses_doctor_when_enough_samples():
    from app.ml_runtime import predict_with_fallback

    meta = {
        "bucket_counts": {"svc-a_10": 50},
        "bucket_counts_by_doctor": {"doc-1_10": 40},
        "min_bucket_samples": 30,
        "avg_service_time_by_service": {"svc-a": 5.0},
        "avg_service_time_by_doctor": {"none": 5.0, "doc-1": 3.0},
    }

    class FakeModel:
        def predict(self, row):
            assert row["doctor"].iloc[0] == "doc-1"
            return [4.2]

    result = predict_with_fallback(FakeModel(), meta, "svc-a", 10, 2, 3, 2, doctor_id="doc-1")
    assert result["doctor_used"] is True
    assert result["predicted_wait_minutes"] == 4.2


def test_predict_with_fallback_falls_back_to_service_level_when_doctor_sparse():
    from app.ml_runtime import predict_with_fallback

    meta = {
        "bucket_counts": {"svc-a_10": 50},
        "bucket_counts_by_doctor": {"doc-1_10": 3},  # below min_bucket_samples
        "min_bucket_samples": 30,
        "avg_service_time_by_service": {"svc-a": 5.0},
        "avg_service_time_by_doctor": {"none": 5.0, "doc-1": 3.0},
    }

    class FakeModel:
        def predict(self, row):
            assert row["doctor"].iloc[0] == "none"
            return [5.1]

    result = predict_with_fallback(FakeModel(), meta, "svc-a", 10, 2, 3, 2, doctor_id="doc-1")
    assert result["doctor_used"] is False
    assert result["predicted_wait_minutes"] == 5.1


def test_predict_with_fallback_ignores_doctor_when_model_predates_doctor_support():
    from app.ml_runtime import predict_with_fallback

    meta = {
        "bucket_counts": {"svc-a_10": 50},
        "min_bucket_samples": 30,
        "avg_service_time_by_service": {"svc-a": 5.0},
        # no avg_service_time_by_doctor at all -- an old artifact
    }

    class FakeModel:
        def predict(self, row):
            assert "doctor" not in row.columns
            return [5.5]

    result = predict_with_fallback(FakeModel(), meta, "svc-a", 10, 2, 3, 2, doctor_id="doc-1")
    assert result["doctor_used"] is False
    assert result["predicted_wait_minutes"] == 5.5


async def test_predict_accepts_optional_doctor_id_and_reports_usage(client, db_pool):
    from scripts.generate_training_data import DOCTOR_IDS

    await _seed_board_service(db_pool)
    doctor_id = DOCTOR_IDS[GENERAL_OPD_ID][0]  # the "faster" seeded doctor
    # hour=4 is where this doctor's real trained bucket count (per the
    # committed ml/model_meta.json) actually clears min_bucket_samples --
    # doctor-hour bucket sizes vary for real (this one ranges 24-49 across
    # the day), so the specific hour matters; not every hour qualifies.
    resp = client.post(
        "/predict",
        json={
            "service_id": GENERAL_OPD_ID,
            "doctor_id": doctor_id,
            "hour": 4,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "doctor_used" in body
    assert body["doctor_used"] is True


async def test_predict_without_doctor_id_still_works(client, db_pool):
    await _seed_board_service(db_pool)
    resp = client.post(
        "/predict",
        json={
            "service_id": GENERAL_OPD_ID,
            "hour": 10,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["doctor_used"] is False
