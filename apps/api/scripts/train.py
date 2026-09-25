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

from generate_training_data import SERVICES, generate_training_data

FEATURE_COLUMNS = ["service", "hour", "weekday", "queue_len_ahead", "counters_open"]
TARGET_COLUMN = "wait_minutes"
MIN_BUCKET_SAMPLES = 30
SEED = 42
N_ROWS = 20_000

ML_DIR = Path(__file__).resolve().parent.parent / "ml"


def main() -> None:
    df = generate_training_data(n_rows=N_ROWS, seed=SEED)

    # Chronological split, not a random shuffle: the last 20% of days are
    # held out entirely, so "how does this do on a day it's never seen"
    # is actually tested, with no leakage across the boundary. `day` is a
    # split key only -- it never enters FEATURE_COLUMNS.
    cutoff_day = df["day"].quantile(0.8)
    train_mask = df["day"] < cutoff_day
    train_rows, test_rows = df[train_mask], df[~train_mask]

    X_train, y_train = train_rows[FEATURE_COLUMNS], train_rows[TARGET_COLUMN]
    X_test, y_test = test_rows[FEATURE_COLUMNS], test_rows[TARGET_COLUMN]

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

    service_rate = X_test["service"].astype(str).map(avg_service_time_by_service).astype(float)

    # Old, acknowledged-unfair baseline (kept only for the model card's
    # side-by-side comparison) -- ignores counters_open entirely.
    old_unfair_baseline_predictions = X_test["queue_len_ahead"] * service_rate
    mae_baseline_old_unfair = mean_absolute_error(y_test, old_unfair_baseline_predictions)

    # Fair baseline: the same queue_len_ahead * avg_service_time / counters_open
    # formula docs/JUDGE_NOTES.md already documents as the mobile app's own
    # client-side fallback -- comparing against this, not a strawman, is what
    # makes the improvement number mean something.
    baseline_predictions = X_test["queue_len_ahead"] * service_rate / X_test["counters_open"]
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
        "mae_baseline_old_unfair": mae_baseline_old_unfair,
        "pct_improvement": pct_improvement,
        "bucket_counts": bucket_counts_dict,
        "min_bucket_samples": MIN_BUCKET_SAMPLES,
        "avg_service_time_by_service": avg_service_time_by_service,
        "split_method": "chronological: last 20% of days held out, cutoff_day=" + str(cutoff_day),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "n_rows": N_ROWS,
        "seed": SEED,
    }
    with open(ML_DIR / "model_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"n_rows={N_ROWS} seed={SEED} split=chronological cutoff_day={cutoff_day}")
    print(f"train_rows={len(X_train)} test_rows={len(X_test)}")
    print(f"mae_model={mae_model:.4f}")
    print(f"mae_baseline_old_unfair={mae_baseline_old_unfair:.4f}  (queue_len_ahead * avg_service_time, no counters_open)")
    print(f"mae_baseline_fair={mae_baseline:.4f}  (queue_len_ahead * avg_service_time / counters_open)")
    print(f"pct_improvement_vs_fair_baseline={pct_improvement:.2f}%")
    print(f"avg_service_time_by_service={avg_service_time_by_service}")
    print(f"bucket_count_min={min(bucket_counts_dict.values())} bucket_count_max={max(bucket_counts_dict.values())}")
    print(f"buckets_below_{MIN_BUCKET_SAMPLES}={sum(1 for c in bucket_counts_dict.values() if c < MIN_BUCKET_SAMPLES)}")


if __name__ == "__main__":
    main()
