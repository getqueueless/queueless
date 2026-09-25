"""Trains the wait-time model offline on synthetic data. Run with:

    uv run python scripts/train.py

Writes ml/wait_time_model.joblib and ml/model_meta.json. Never run this at
request time -- app.ml_runtime loads these artifacts once at FastAPI startup.
The fit-and-evaluate logic itself lives in scripts/train_core.py, shared
with app/routes/admin.py's /admin/retrain (real data) -- this file only
generates synthetic data, calls that shared core, and writes the artifacts.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib

from generate_training_data import DOCTORS, SERVICES, generate_training_data
from train_core import (
    DEFAULT_MIN_BUCKET_SAMPLES,
    DEFAULT_SEED,
    read_previous_version,
    train_and_evaluate,
)

FEATURE_COLUMNS = ["service", "doctor", "hour", "weekday", "queue_len_ahead", "counters_open"]
TARGET_COLUMN = "wait_minutes"
MIN_BUCKET_SAMPLES = DEFAULT_MIN_BUCKET_SAMPLES
SEED = DEFAULT_SEED
N_ROWS = 20_000

ML_DIR = Path(__file__).resolve().parent.parent / "ml"


def main() -> None:
    df = generate_training_data(n_rows=N_ROWS, seed=SEED)
    model, meta = train_and_evaluate(
        df, FEATURE_COLUMNS, TARGET_COLUMN, SERVICES,
        min_bucket_samples=MIN_BUCKET_SAMPLES, seed=SEED, doctor_categories=DOCTORS,
    )

    # version: bump on every successful train, starting at 1 if no prior
    # artifact exists. /admin/model and /admin/retrain both read/write this.
    meta_path = ML_DIR / "model_meta.json"
    meta["version"] = read_previous_version(meta_path) + 1
    meta["trained_on"] = "synthetic"
    meta["trained_at"] = datetime.now(timezone.utc).isoformat()
    meta["seed"] = SEED

    ML_DIR.mkdir(exist_ok=True)
    joblib.dump(model, ML_DIR / "wait_time_model.joblib")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"n_rows={meta['n_rows']} seed={SEED} version={meta['version']} split={meta['split_method']}")
    print(f"mae_model={meta['mae_model']:.4f}")
    print(f"mae_baseline_old_unfair={meta['mae_baseline_old_unfair']:.4f}  (queue_len_ahead * avg_service_time, no counters_open)")
    print(f"mae_baseline_fair={meta['mae_baseline']:.4f}  (queue_len_ahead * avg_service_time / counters_open)")
    print(f"pct_improvement_vs_fair_baseline={meta['pct_improvement']:.2f}%")
    print(f"mae_model_by_service={meta['mae_model_by_service']}")
    print(f"avg_service_time_by_service={meta['avg_service_time_by_service']}")
    print(f"mae_model_by_doctor={meta.get('mae_model_by_doctor')}")
    print(f"buckets_below_{MIN_BUCKET_SAMPLES}={sum(1 for c in meta['bucket_counts'].values() if c < MIN_BUCKET_SAMPLES)}")


if __name__ == "__main__":
    main()
