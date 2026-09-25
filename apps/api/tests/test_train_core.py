"""train_core.train_and_evaluate is the shared fit-and-evaluate core both
scripts/train.py (synthetic data) and app/routes/admin.py's /admin/retrain
(real data) call -- one copy of the HistGradientBoostingRegressor fit +
fair-baseline + bucket-count + per-service-MAE logic, not two drifting
copies."""

import numpy as np
import pandas as pd
import pytest

from scripts.train_core import train_and_evaluate

FEATURE_COLUMNS = ["service", "hour", "weekday", "queue_len_ahead", "counters_open"]
TARGET_COLUMN = "wait_minutes"
SERVICE_CATEGORIES = ["svc-a", "svc-b"]


def _toy_df(n_rows: int = 400, n_days: int = 20, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    service = rng.choice(SERVICE_CATEGORIES, size=n_rows)
    hour = rng.integers(0, 24, size=n_rows)
    weekday = rng.integers(0, 7, size=n_rows)
    day = rng.integers(0, n_days, size=n_rows)
    queue_len_ahead = rng.integers(0, 20, size=n_rows)
    counters_open = rng.integers(1, 4, size=n_rows)
    base = np.where(service == "svc-a", 8.0, 14.0)
    wait_minutes = base * queue_len_ahead / counters_open + rng.gamma(2.0, 1.5, size=n_rows)
    return pd.DataFrame(
        {
            "service": pd.Categorical(service, categories=SERVICE_CATEGORIES),
            "hour": hour,
            "weekday": weekday,
            "day": day,
            "queue_len_ahead": queue_len_ahead,
            "counters_open": counters_open,
            "wait_minutes": wait_minutes,
        }
    )


def test_train_and_evaluate_returns_model_and_meta():
    df = _toy_df()
    model, meta = train_and_evaluate(df, FEATURE_COLUMNS, TARGET_COLUMN, SERVICE_CATEGORIES)

    assert model is not None
    assert hasattr(model, "predict")
    for key in (
        "mae_model",
        "mae_baseline",
        "mae_baseline_old_unfair",
        "pct_improvement",
        "mae_model_by_service",
        "bucket_counts",
        "min_bucket_samples",
        "avg_service_time_by_service",
        "split_method",
        "n_rows",
        "sklearn_version",
    ):
        assert key in meta, f"missing meta key: {key}"


def test_train_and_evaluate_mae_model_by_service_covers_every_category():
    df = _toy_df()
    _, meta = train_and_evaluate(df, FEATURE_COLUMNS, TARGET_COLUMN, SERVICE_CATEGORIES)

    assert set(meta["mae_model_by_service"].keys()) == set(SERVICE_CATEGORIES)
    for mae in meta["mae_model_by_service"].values():
        assert mae >= 0


def test_train_and_evaluate_uses_chronological_split_not_random():
    df = _toy_df()
    _, meta = train_and_evaluate(df, FEATURE_COLUMNS, TARGET_COLUMN, SERVICE_CATEGORIES)

    assert meta["split_method"].startswith("chronological")


def test_train_and_evaluate_respects_min_bucket_samples_param():
    df = _toy_df()
    _, meta = train_and_evaluate(
        df, FEATURE_COLUMNS, TARGET_COLUMN, SERVICE_CATEGORIES, min_bucket_samples=5
    )
    assert meta["min_bucket_samples"] == 5


def test_read_previous_version_defaults_to_zero_when_no_meta_file(tmp_path):
    from scripts.train_core import read_previous_version

    assert read_previous_version(tmp_path / "does_not_exist.json") == 0


def test_read_previous_version_reads_existing_version(tmp_path):
    import json

    from scripts.train_core import read_previous_version

    meta_path = tmp_path / "model_meta.json"
    meta_path.write_text(json.dumps({"version": 4}))
    assert read_previous_version(meta_path) == 4


def test_read_previous_version_defaults_to_zero_when_field_absent(tmp_path):
    import json

    from scripts.train_core import read_previous_version

    meta_path = tmp_path / "model_meta.json"
    meta_path.write_text(json.dumps({"mae_model": 1.0}))
    assert read_previous_version(meta_path) == 0
