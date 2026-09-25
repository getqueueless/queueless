"""New Prometheus metrics for Round 3's "deployment, monitoring, logging"
ask. Request latency/error-count-by-route are already covered by
prometheus_fastapi_instrumentator (app/main.py) -- these are the ones
apps/api has to compute itself."""

from app.metrics import (
    deepseek_call_duration_seconds,
    deepseek_call_failures_total,
    notification_delivery_lag_seconds,
    retrain_last_success,
    retrain_duration_seconds,
    tokens_issued_total,
)


def test_tokens_issued_total_is_a_counter_incrementable_by_amount():
    before = tokens_issued_total.labels(service="svc-a")._value.get()
    tokens_issued_total.labels(service="svc-a").inc(5)
    after = tokens_issued_total.labels(service="svc-a")._value.get()
    assert after == before + 5


def test_notification_delivery_lag_observable():
    notification_delivery_lag_seconds.observe(3.5)
    # No exception is the test -- prometheus_client histograms don't expose
    # a trivial read-back API; existence + callability is what matters here.


def test_deepseek_metrics_exist_and_are_labelable():
    deepseek_call_duration_seconds.labels(call_type="ask_tool_select").observe(0.5)
    deepseek_call_failures_total.labels(call_type="translate").inc()


def test_retrain_status_gauges():
    retrain_last_success.set(1)
    assert retrain_last_success._value.get() == 1
    retrain_duration_seconds.set(12.3)
    assert retrain_duration_seconds._value.get() == 12.3
