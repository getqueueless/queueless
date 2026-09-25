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
    doctor_id: str | None = None,
) -> dict:
    doctor_trained = "avg_service_time_by_doctor" in meta

    # doctor_id is honored only when the loaded model was actually trained
    # with a "doctor" feature (a real per-org UUID isn't necessarily one of
    # the categories a model.predict() call below understands) AND that
    # specific doctor has enough historical samples for this hour --
    # otherwise this falls back to "none" (generic/service-level), the same
    # category every prediction used before doctor support existed. Either
    # way service-level fallback logic (below) is unchanged.
    doctor_category = "none"
    doctor_used = False
    if doctor_trained and doctor_id is not None:
        doctor_bucket_key = f"{doctor_id}_{hour}"
        doctor_bucket_count = meta.get("bucket_counts_by_doctor", {}).get(doctor_bucket_key, 0)
        if doctor_bucket_count >= meta["min_bucket_samples"] and doctor_id in meta["avg_service_time_by_doctor"]:
            doctor_category = doctor_id
            doctor_used = True

    bucket_key = f"{service}_{hour}"
    bucket_count = meta["bucket_counts"].get(bucket_key, 0)

    if bucket_count < meta["min_bucket_samples"]:
        avg_service_time = meta["avg_service_time_by_service"].get(service)
        reason = "sparse_training_data"
        if avg_service_time is None:
            # service is real (predict.py already checked board_services)
            # but never appeared in the data this model trained on -- e.g.
            # created after the last retrain. Found live in prod
            # (docs/DECISIONS.md, 2026-09-26): a direct dict index here
            # raised an uncaught KeyError -> 500 for a perfectly valid
            # service_id. Fall back to the mean of every service the model
            # does know, instead of crashing.
            known_averages = [v for v in meta["avg_service_time_by_service"].values() if v is not None]
            avg_service_time = sum(known_averages) / len(known_averages) if known_averages else 0.0
            reason = "unknown_to_model"
        # Same formula scripts/train.py validates against as the "fair
        # baseline" (and that docs/JUDGE_NOTES.md documents as the mobile
        # app's own client-side fallback) -- the live fallback shown to real
        # users must match the number actually measured, not a different one.
        return {
            "predicted_wait_minutes": queue_len_ahead * avg_service_time / counters_open,
            "fallback": True,
            "reason": reason,
            "doctor_used": False,
        }

    row_dict = {
        "service": pd.Categorical([service], categories=list(meta["avg_service_time_by_service"]))[0],
        "hour": hour,
        "weekday": weekday,
        "queue_len_ahead": queue_len_ahead,
        "counters_open": counters_open,
    }
    if doctor_trained:
        row_dict["doctor"] = pd.Categorical([doctor_category], categories=list(meta["avg_service_time_by_doctor"]))[0]
    row = pd.DataFrame([row_dict])
    prediction = float(model.predict(row)[0])
    return {"predicted_wait_minutes": prediction, "fallback": False, "reason": None, "doctor_used": doctor_used}
