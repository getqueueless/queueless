"""Trains the wait-time model offline. Run with:

    uv run python scripts/train.py

Writes ml/wait_time_model.joblib and ml/model_meta.json. Never run this at
request time -- app.ml_runtime loads these artifacts once at FastAPI startup.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from generate_training_data import SERVICES, generate_training_data

FEATURE_COLUMNS = ["service", "hour", "weekday", "queue_len_ahead", "counters_open"]
TARGET_COLUMN = "wait_minutes"
MIN_BUCKET_SAMPLES = 30
SEED = 42
N_ROWS = 20_000

ML_DIR = Path(__file__).resolve().parent.parent / "ml"


def main() -> None:
    df = generate_training_data(n_rows=N_ROWS, seed=SEED)
    X = df[FEATURE_COLUMNS]
    y = df[TARGET_COLUMN]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=SEED
    )

    model = HistGradientBoostingRegressor(
        categorical_features=["service"], random_state=SEED
    )
    model.fit(X_train, y_train)
    model_predictions = model.predict(X_test)
    mae_model = mean_absolute_error(y_test, model_predictions)

    train_df = X_train.copy()
    train_df[TARGET_COLUMN] = y_train
    avg_service_time_by_service = (
        train_df.assign(effective_queue=train_df["queue_len_ahead"].clip(lower=1))
        .assign(rate=lambda d: d[TARGET_COLUMN] / d["effective_queue"])
        .groupby("service", observed=True)["rate"]
        .mean()
        .reindex(SERVICES)
        .to_dict()
    )

    baseline_predictions = X_test["queue_len_ahead"] * (
        X_test["service"].astype(str).map(avg_service_time_by_service).astype(float)
    )
    mae_baseline = mean_absolute_error(y_test, baseline_predictions)
    pct_improvement = (mae_baseline - mae_model) / mae_baseline * 100

    bucket_counts = (
        train_df.groupby(["service", "hour"], observed=True)
        .size()
        .rename("count")
        .reset_index()
    )
    bucket_counts_dict = {
        f"{row.service}_{row.hour}": int(row.count) for row in bucket_counts.itertuples()
    }

    ML_DIR.mkdir(exist_ok=True)
    joblib.dump(model, ML_DIR / "wait_time_model.joblib")

    meta = {
        "mae_model": mae_model,
        "mae_baseline": mae_baseline,
        "pct_improvement": pct_improvement,
        "bucket_counts": bucket_counts_dict,
        "min_bucket_samples": MIN_BUCKET_SAMPLES,
        "avg_service_time_by_service": avg_service_time_by_service,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "n_rows": N_ROWS,
        "seed": SEED,
    }
    with open(ML_DIR / "model_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"n_rows={N_ROWS} seed={SEED}")
    print(f"mae_model={mae_model:.4f}")
    print(f"mae_baseline={mae_baseline:.4f}")
    print(f"pct_improvement={pct_improvement:.2f}%")
    print(f"avg_service_time_by_service={avg_service_time_by_service}")
    print(f"bucket_count_min={min(bucket_counts_dict.values())} bucket_count_max={max(bucket_counts_dict.values())}")
    print(f"buckets_below_{MIN_BUCKET_SAMPLES}={sum(1 for c in bucket_counts_dict.values() if c < MIN_BUCKET_SAMPLES)}")


if __name__ == "__main__":
    main()
