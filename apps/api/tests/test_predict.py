def test_predict_returns_model_prediction_for_a_well_sampled_bucket(client):
    resp = client.post(
        "/predict",
        json={
            "service": "general_opd",
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


def test_predict_falls_back_for_sparse_bucket(client):
    import app.main as main_module

    original = main_module.app.state.ml_meta["bucket_counts"].get("general_opd_10")
    main_module.app.state.ml_meta["bucket_counts"]["general_opd_10"] = 3
    try:
        resp = client.post(
            "/predict",
            json={
                "service": "general_opd",
                "hour": 10,
                "weekday": 2,
                "queue_len_ahead": 5,
                "counters_open": 2,
            },
        )
    finally:
        main_module.app.state.ml_meta["bucket_counts"]["general_opd_10"] = original

    assert resp.status_code == 200
    body = resp.json()
    assert body["fallback"] is True
    assert body["reason"] == "sparse_training_data"
    expected = 5 * main_module.app.state.ml_meta["avg_service_time_by_service"]["general_opd"]
    assert body["predicted_wait_minutes"] == expected


def test_predict_rejects_unknown_service(client):
    resp = client.post(
        "/predict",
        json={
            "service": "cardiology",
            "hour": 10,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 422


def test_predict_rejects_out_of_range_hour(client):
    resp = client.post(
        "/predict",
        json={
            "service": "general_opd",
            "hour": 24,
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 422


def test_predict_rejects_wrong_type(client):
    resp = client.post(
        "/predict",
        json={
            "service": "general_opd",
            "hour": "ten",
            "weekday": 2,
            "queue_len_ahead": 5,
            "counters_open": 2,
        },
    )
    assert resp.status_code == 422
