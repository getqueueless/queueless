"""Synthetic wait-time training data for the Hospital OPD demo preset.

This is synthetic data, not real patient data. Generating assumptions (also
documented verbatim in docs/api/model-card.md):
  - Per-service per-patient consultation time is now calibrated to
    published Indian OPD studies, not an arbitrary constant, drawn per row
    from a right-skewed lognormal fit to each study's real (mean, SD):
      * General OPD: mean 6.925 min, SD 7.688 min -- tertiary care
        hospital, Maharashtra (IJCMPH: "Prescribing Pattern... Outpatient
        Department"), https://www.ijcmph.com/index.php/ijcmph/article/view/11281
      * Pharmacy: mean 81.5s (1.358 min), SD 51.2s (0.853 min) -- central
        Maharashtra tertiary hospital dispensing time,
        https://www.academia.edu/43251675/Prescription_pattern_at_outpatient_department_in_a_tertiary_care_hospital_at_central_Maharashtra_India
      * Pediatrics, Orthopedics: no Indian department-specific service-time
        study was found -- ASSUMPTION: reuses General OPD's calibration
        (mean 6.925, SD 7.688). A Kolkata tertiary-care study (waiting time,
        not service time -- https://www.ijcmph.com/index.php/ijcmph/article/view/5276)
        shows pediatric OPD has the shortest real wait (43 min vs 122 min
        overall), which this generator does NOT model -- it only has a
        service-time assumption, not a queue-composition one, for these two.
    Context for how these compare internationally: the BMJ Open 2017
    systematic review (Irving et al., 67 countries,
    https://research.edgehill.ac.uk/ws/portalfiles/portal/29790731/International_variations_in_primary_care_physician_consultation_time.pdf)
    puts India's primary-care consultation at ~2 min; a Kolkata tertiary
    study (Ovid IJCM,
    https://www.ovid.com/jnls/ijcm/fulltext/10.4103/ijcm.ijcm_abstract210~ijcm210a-assessment-of-outdoor-patients-waiting-time-and)
    reports government super-speciality clinics at ~2 min for 200+
    patients/day -- private/tertiary OPDs (what this demo models) run
    longer, ~6-7 min, which is what General OPD's calibration above uses.
  - Peak-hour multiplier ~1.4x for hour in {9, 10, 11, 14, 15}.
  - Monday multiplier ~1.2x for weekday == 0.
  - A shared per-day busy/slow multiplier (mean 1.0, std 0.08) so a
    chronological train/test split (scripts/train.py) has a real day-level
    signal to hold out, instead of nothing to leak across.
  - Doctor-level (v2): 2 seeded doctors per service, each with a fixed speed
    multiplier relative to their service's calibrated mean (one faster, one
    slower) -- real, per-doctor variance in service time exists in the real
    system (supabase/migrations/0038-0040: doctors, schedules,
    `tokens.doctor_id`, `analytics.doctor_service_time`), and the real DB
    honestly has no open-counters-style live signal to reconstruct
    historically, but per-doctor speed IS directly observable in
    `tokens.finished_at - serving_at` once real doctor-attributed tokens
    exist. 40% of rows are attributed to a specific doctor (doctor !=
    "none"); the rest are generic/unattributed walk-ins, matching how
    doctor tracking rolled out on top of an existing doctor-less queue
    rather than replacing it.
  - wait_minutes = per_patient_service_time * doctor_mult * peak_mult *
    monday_mult * daily_mult * queue_len_ahead / counters_open, clipped at
    0 -- the lognormal draw above IS the noise source now (real, cited
    variance), no separate additive noise term on top of it. This directly
    satisfies the sanity rule tests/test_generate_training_data.py checks:
    one patient takes ~X min (the calibrated mean), so the person behind
    them (queue_len_ahead=1, counters_open=1) waits ~X min too, before
    peak/doctor/day adjustments.

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

# (mean_minutes, sd_minutes) per service -- the real, cited numbers above.
# Pediatrics/Orthopedics are explicitly the General OPD ASSUMPTION, not
# their own measured study.
SERVICE_TIME_STATS_MINUTES = {
    SERVICE_IDS["General OPD"]: (6.925, 7.688),
    SERVICE_IDS["Pediatrics"]: (6.925, 7.688),   # ASSUMPTION: no Indian pediatric-OPD service-time study found
    SERVICE_IDS["Orthopedics"]: (6.925, 7.688),  # ASSUMPTION: no Indian orthopedic-OPD service-time study found
    SERVICE_IDS["Pharmacy"]: (81.5 / 60, 51.2 / 60),
}
SERVICES = list(SERVICE_TIME_STATS_MINUTES)


def _lognormal_params(mean: float, sd: float) -> tuple[float, float]:
    """The (mu, sigma) of the underlying normal that makes
    np.random.lognormal produce draws with the given real-world (mean, sd)
    -- lognormal is parameterized by the underlying normal's params, not
    the distribution's own mean/sd directly."""
    sigma_sq = np.log(1 + (sd / mean) ** 2)
    mu = np.log(mean) - sigma_sq / 2
    return mu, np.sqrt(sigma_sq)


LOGNORMAL_PARAMS = {service: _lognormal_params(*stats) for service, stats in SERVICE_TIME_STATS_MINUTES.items()}
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

    # Per-patient consultation time, drawn per row from each service's real,
    # cited (mean, sd) as a right-skewed lognormal -- this IS the noise
    # source now (real-world variance), not a separate additive term.
    mu_arr = np.array([LOGNORMAL_PARAMS[s][0] for s in service])
    sigma_arr = np.array([LOGNORMAL_PARAMS[s][1] for s in service])
    per_patient_service_time = rng.lognormal(mean=mu_arr, sigma=sigma_arr)

    doctor_mult = np.array([DOCTOR_MULTIPLIER.get(d, 1.0) for d in doctor], dtype=float)
    peak_mult = np.where(np.isin(hour, list(PEAK_HOURS)), PEAK_MULTIPLIER, 1.0)
    monday_mult = np.where(weekday == 0, MONDAY_MULTIPLIER, 1.0)
    # day is a split key (scripts/train.py's chronological cutoff), not a
    # model feature -- a raw day index would just let the model memorize it.
    daily_mult = rng.normal(1.0, DAILY_NOISE_STD, size=n_days)[day]

    signal = per_patient_service_time * doctor_mult * peak_mult * monday_mult * daily_mult
    wait_minutes = np.clip(signal * queue_len_ahead / counters_open, a_min=0, a_max=None)

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
