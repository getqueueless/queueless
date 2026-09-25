"""Synthetic wait-time training data for the Hospital OPD demo preset.

This is synthetic data, not real patient data. Generating assumptions (also
documented verbatim in docs/api/model-card.md):
  - Per-service base minutes, keyed by the real demo org's service_id (no
    human-readable name is available to apps/api at query time -- its DB
    role has SELECT on board_services but not on services, per
    supabase/migrations/0018_queueless_api_role.sql):
    General OPD=8, Pediatrics=10, Orthopedics=14, Pharmacy=4.
  - Peak-hour multiplier ~1.4x for hour in {9, 10, 11, 14, 15}.
  - Monday multiplier ~1.2x for weekday == 0.
  - A shared per-day busy/slow multiplier (mean 1.0, std 0.08) so a
    chronological train/test split (scripts/train.py) has a real day-level
    signal to hold out, instead of nothing to leak across.
  - Doctor-level (v2): 2 seeded doctors per service, each with a fixed speed
    multiplier relative to their service's base (one faster, one slower) --
    real, per-doctor variance in service time exists in the real system
    (supabase/migrations/0038-0040: doctors, schedules, `tokens.doctor_id`,
    `analytics.doctor_service_time`), and the real DB honestly has no
    open-counters-style live signal to reconstruct historically, but per-
    doctor speed IS directly observable in `tokens.finished_at - serving_at`
    once real doctor-attributed tokens exist. 40% of rows are attributed to
    a specific doctor (doctor != "none"); the rest are generic/unattributed
    walk-ins, matching how doctor tracking rolled out on top of an existing
    doctor-less queue rather than replacing it.
  - wait_minutes = base * doctor_mult * peak_mult * monday_mult * daily_mult
    * queue_len_ahead / counters_open, plus right-skewed noise via
    rng.gamma (not Gaussian), clipped at 0.

No supabase/scripts/seed.sh exists yet (checked as of this writing -- only
migrate.sh/reset.sh/smoke.sh/test.sh are present), so there is no live demo
org to pull real service_id/doctor_id values from. SERVICE_IDS/DOCTOR_IDS
below are fixed placeholder UUIDs for one demo org's 4 real Hospital OPD
services (General OPD, Pediatrics, Orthopedics, Pharmacy -- Dental and Eye
do not exist in the real system and have been removed) and 2 doctors per
service. Retrain against the real values the moment a seed script lands.
"""

import numpy as np
import pandas as pd

SERVICE_IDS = {
    "General OPD": "10000000-0000-0000-0000-000000000001",
    "Pediatrics": "10000000-0000-0000-0000-000000000002",
    "Orthopedics": "10000000-0000-0000-0000-000000000003",
    "Pharmacy": "10000000-0000-0000-0000-000000000004",
}
BASE_MINUTES = {
    SERVICE_IDS["General OPD"]: 8,
    SERVICE_IDS["Pediatrics"]: 10,
    SERVICE_IDS["Orthopedics"]: 14,
    SERVICE_IDS["Pharmacy"]: 4,
}
SERVICES = list(BASE_MINUTES)
PEAK_HOURS = {9, 10, 11, 14, 15}
PEAK_MULTIPLIER = 1.4
MONDAY_MULTIPLIER = 1.2
DAILY_NOISE_STD = 0.08

# 2 doctors per service: one faster (0.8x), one slower (1.25x) than the
# service's own base rate. "none" (no doctor attribution) is always a valid
# category too -- see DOCTOR_ATTRIBUTION_RATE below.
DOCTOR_IDS = {
    SERVICE_IDS["General OPD"]: [
        "20000000-0000-0000-0000-000000000001",
        "20000000-0000-0000-0000-000000000002",
    ],
    SERVICE_IDS["Pediatrics"]: [
        "20000000-0000-0000-0000-000000000003",
        "20000000-0000-0000-0000-000000000004",
    ],
    SERVICE_IDS["Orthopedics"]: [
        "20000000-0000-0000-0000-000000000005",
        "20000000-0000-0000-0000-000000000006",
    ],
    SERVICE_IDS["Pharmacy"]: [
        "20000000-0000-0000-0000-000000000007",
        "20000000-0000-0000-0000-000000000008",
    ],
}
DOCTOR_MULTIPLIER = {}
for _service, _doctors in DOCTOR_IDS.items():
    DOCTOR_MULTIPLIER[_doctors[0]] = 0.8   # faster
    DOCTOR_MULTIPLIER[_doctors[1]] = 1.25  # slower
DOCTORS = ["none"] + [d for ds in DOCTOR_IDS.values() for d in ds]
DOCTOR_ATTRIBUTION_RATE = 0.4


def generate_training_data(n_rows: int = 20_000, seed: int = 42, n_days: int = 120) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    service = rng.choice(SERVICES, size=n_rows)
    hour = rng.integers(0, 24, size=n_rows)
    weekday = rng.integers(0, 7, size=n_rows)
    day = rng.integers(0, n_days, size=n_rows)
    queue_len_ahead = rng.integers(0, 30, size=n_rows)
    counters_open = rng.integers(1, 5, size=n_rows)

    attributed = rng.random(n_rows) < DOCTOR_ATTRIBUTION_RATE
    # rng.choice needs a fixed-size candidate list per draw; picking index 0
    # or 1 within that service's own 2 doctors keeps it vectorized instead
    # of a per-row Python loop.
    doctor_slot = rng.integers(0, 2, size=n_rows)
    doctor = np.where(
        attributed,
        [DOCTOR_IDS[s][slot] for s, slot in zip(service, doctor_slot)],
        "none",
    )

    base = np.array([BASE_MINUTES[s] for s in service], dtype=float)
    doctor_mult = np.array([DOCTOR_MULTIPLIER.get(d, 1.0) for d in doctor], dtype=float)
    peak_mult = np.where(np.isin(hour, list(PEAK_HOURS)), PEAK_MULTIPLIER, 1.0)
    monday_mult = np.where(weekday == 0, MONDAY_MULTIPLIER, 1.0)
    # day is a split key (scripts/train.py's chronological cutoff), not a
    # model feature -- a raw day index would just let the model memorize it.
    daily_mult = rng.normal(1.0, DAILY_NOISE_STD, size=n_days)[day]

    signal = base * doctor_mult * peak_mult * monday_mult * daily_mult * queue_len_ahead / counters_open
    noise = rng.gamma(shape=2.0, scale=3.0, size=n_rows)
    wait_minutes = np.clip(signal + noise, a_min=0, a_max=None)

    return pd.DataFrame(
        {
            "service": pd.Categorical(service, categories=SERVICES),
            "doctor": pd.Categorical(doctor, categories=DOCTORS),
            "hour": hour,
            "weekday": weekday,
            "day": day,
            "queue_len_ahead": queue_len_ahead,
            "counters_open": counters_open,
            "wait_minutes": wait_minutes,
        }
    )


if __name__ == "__main__":
    import sys

    df = generate_training_data()
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/dev/stdout"
    df.to_csv(out_path, index=False)
