import json
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI

ML_DIR = Path(__file__).resolve().parent.parent / "ml"


def load(app: FastAPI) -> None:
    app.state.ml_model = joblib.load(ML_DIR / "wait_time_model.joblib")
    with open(ML_DIR / "model_meta.json") as f:
        app.state.ml_meta = json.load(f)


def predict_with_fallback(
    model,
    meta: dict,
    service: str,
    hour: int,
    weekday: int,
    queue_len_ahead: int,
    counters_open: int,
) -> dict:
    bucket_key = f"{service}_{hour}"
    bucket_count = meta["bucket_counts"].get(bucket_key, 0)

    if bucket_count < meta["min_bucket_samples"]:
        avg_service_time = meta["avg_service_time_by_service"][service]
        return {
            "predicted_wait_minutes": queue_len_ahead * avg_service_time,
            "fallback": True,
            "reason": "sparse_training_data",
        }

    row = pd.DataFrame(
        [
            {
                "service": pd.Categorical([service], categories=list(meta["avg_service_time_by_service"]))[0],
                "hour": hour,
                "weekday": weekday,
                "queue_len_ahead": queue_len_ahead,
                "counters_open": counters_open,
            }
        ]
    )
    prediction = float(model.predict(row)[0])
    return {"predicted_wait_minutes": prediction, "fallback": False, "reason": None}
