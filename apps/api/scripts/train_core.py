"""Shared fit-and-evaluate core for the wait-time model.

Both scripts/train.py (synthetic data, CLI) and app/routes/admin.py's
/admin/retrain (real completed-token data) call train_and_evaluate -- one
copy of the HistGradientBoostingRegressor fit + fair-baseline + bucket-count
+ per-service-MAE logic, not two independent copies that can drift apart.
"""

import json
import math
from pathlib import Path

import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

DEFAULT_MIN_BUCKET_SAMPLES = 30
DEFAULT_SEED = 42


def _nan_to_none(d: dict) -> dict:
    """A service with zero rows in a given split (real deployments with
    little history for one service, or a small test fixture) produces NaN
    from pandas' mean()/reindex(). NaN isn't valid JSON -- json.dumps emits
    a bare `NaN` token that Postgres's jsonb parser (among others) rejects.
    None is also the honest value here: "no data," not "zero"."""
    return {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in d.items()}


def read_previous_version(meta_path: Path) -> int:
    """The version to bump from -- 0 if no prior artifact exists or the
    prior one predates the version field. Both scripts/train.py and
    /admin/retrain call this before writing a new model_meta.json."""
    if not Path(meta_path).exists():
        return 0
    with open(meta_path) as f:
        return json.load(f).get("version", 0)


def train_and_evaluate(
    df,
    feature_columns: list[str],
    target_column: str,
    service_categories: list[str],
    min_bucket_samples: int = DEFAULT_MIN_BUCKET_SAMPLES,
    seed: int = DEFAULT_SEED,
):
    """Fits a HistGradientBoostingRegressor with a chronological train/test
    split (last 20% of `day` values held out, no shuffling across the
    boundary) and evaluates it against a fair baseline.

    `df` must have `feature_columns` + `target_column` + a `day` int column
    (split key only, never a model feature -- a raw day index would just
    let the model memorize it). `service_categories` fixes the categorical
    dtype's category set so every metric dict below has one entry per real
    service even if a given split happens to have zero rows for one.

    Returns (model, meta) where meta has: mae_model, mae_baseline (fair),
    mae_baseline_old_unfair, pct_improvement, mae_model_by_service,
    bucket_counts, min_bucket_samples, avg_service_time_by_service,
    split_method, n_rows, sklearn_version. Caller adds run-specific fields
    (trained_at, seed, trained_on, version) -- those aren't this function's
    concern, since a retrain run and a synthetic CLI run each mean something
    different by them.
    """
    cutoff_day = df["day"].quantile(0.8)
    train_mask = df["day"] < cutoff_day
    train_rows, test_rows = df[train_mask], df[~train_mask]

    X_train, y_train = train_rows[feature_columns], train_rows[target_column]
    X_test, y_test = test_rows[feature_columns], test_rows[target_column]

    model = HistGradientBoostingRegressor(categorical_features=["service"], random_state=seed)
    model.fit(X_train, y_train)
    model_predictions = model.predict(X_test)
    mae_model = mean_absolute_error(y_test, model_predictions)

    train_df = X_train.copy()
    train_df[target_column] = y_train
    avg_service_time_by_service = _nan_to_none(
        train_df.assign(effective_queue=train_df["queue_len_ahead"].clip(lower=1))
        .assign(rate=lambda d: d[target_column] / d["effective_queue"])
        .groupby("service", observed=True)["rate"]
        .mean()
        .reindex(service_categories)
        .to_dict()
    )

    service_rate = X_test["service"].astype(str).map(avg_service_time_by_service).astype(float)

    # Old, acknowledged-unfair baseline (kept only for the model card's
    # side-by-side comparison) -- ignores counters_open entirely.
    old_unfair_baseline_predictions = X_test["queue_len_ahead"] * service_rate
    mae_baseline_old_unfair = mean_absolute_error(y_test, old_unfair_baseline_predictions)

    # Fair baseline: the same queue_len_ahead * avg_service_time / counters_open
    # formula docs/JUDGE_NOTES.md documents as the mobile app's own client-side
    # fallback -- comparing against this, not a strawman, is what makes the
    # improvement number mean something.
    baseline_predictions = X_test["queue_len_ahead"] * service_rate / X_test["counters_open"]
    mae_baseline = mean_absolute_error(y_test, baseline_predictions)
    pct_improvement = (mae_baseline - mae_model) / mae_baseline * 100

    results = X_test.assign(
        _y_true=y_test.to_numpy(),
        _abs_err=(y_test.to_numpy() - model_predictions).__abs__(),
    )
    mae_model_by_service = _nan_to_none(
        results.groupby("service", observed=True)["_abs_err"]
        .mean()
        .reindex(service_categories)
        .to_dict()
    )

    bucket_counts = (
        train_df.groupby(["service", "hour"], observed=True).size().rename("count").reset_index()
    )
    bucket_counts_dict = {
        f"{row.service}_{row.hour}": int(row.count) for row in bucket_counts.itertuples()
    }

    meta = {
        "mae_model": mae_model,
        "mae_baseline": mae_baseline,
        "mae_baseline_old_unfair": mae_baseline_old_unfair,
        "pct_improvement": pct_improvement,
        "mae_model_by_service": mae_model_by_service,
        "bucket_counts": bucket_counts_dict,
        "min_bucket_samples": min_bucket_samples,
        "avg_service_time_by_service": avg_service_time_by_service,
        "split_method": "chronological: last 20% of days held out, cutoff_day=" + str(cutoff_day),
        "n_rows": len(df),
        "sklearn_version": sklearn.__version__,
    }
    return model, meta
