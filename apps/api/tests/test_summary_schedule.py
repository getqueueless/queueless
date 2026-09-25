"""compute_next_run_seconds is pure -- no real waiting needed to prove the
21:00 Asia/Kolkata scheduling logic."""

from datetime import datetime, timezone

from app.summary import compute_next_run_seconds


def test_before_target_hour_same_day():
    # 2026-01-01 10:00 UTC = 15:30 IST -- next 21:00 IST is later the same day.
    now = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    seconds = compute_next_run_seconds(now, hour=21, tz_name="Asia/Kolkata")
    assert 0 < seconds <= 24 * 3600
    # 21:00 - 15:30 = 5h30m = 19800s
    assert abs(seconds - 19800) < 1


def test_after_target_hour_rolls_to_next_day():
    # 2026-01-01 18:00 UTC = 23:30 IST -- 21:00 IST already passed today, so
    # the next occurrence is tomorrow 21:00 IST: 21h30m away = 77400s.
    now = datetime(2026, 1, 1, 18, 0, tzinfo=timezone.utc)
    seconds = compute_next_run_seconds(now, hour=21, tz_name="Asia/Kolkata")
    assert abs(seconds - 77400) < 1


def test_exactly_at_target_hour_rolls_to_next_day():
    # 21:00 IST = 15:30 UTC exactly -- must not return 0 (already-fired tick).
    now = datetime(2026, 1, 1, 15, 30, tzinfo=timezone.utc)
    seconds = compute_next_run_seconds(now, hour=21, tz_name="Asia/Kolkata")
    assert seconds == 24 * 3600
