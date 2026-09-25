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
