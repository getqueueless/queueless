from prometheus_client import Counter, Gauge, Histogram

queue_depth = Gauge("queue_depth", "Waiting tokens per service", ["service"])

# Request latency histograms and error counts by route are already covered
# by prometheus_fastapi_instrumentator (app/main.py) -- everything below is
# what apps/api has to compute itself, since it's not generic HTTP-layer
# instrumentation.

tokens_issued_total = Counter(
    "tokens_issued_total", "Tokens observed as newly created, by service", ["service"]
)

notification_delivery_lag_seconds = Histogram(
    "notification_delivery_lag_seconds",
    "Time between a notification row being created and apps/api marking it pushed",
    buckets=(0.5, 1, 2, 5, 10, 30, 60, 120, 300),
)

deepseek_call_duration_seconds = Histogram(
    "deepseek_call_duration_seconds",
    "DeepSeek API call latency",
    ["call_type"],
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30),
)
deepseek_call_failures_total = Counter(
    "deepseek_call_failures_total", "DeepSeek API calls that raised", ["call_type"]
)

# Gauges, not counters: "the outcome/duration of the most recent retrain" is
# exactly what an ops dashboard or alert wants to read at any moment, not a
# running total.
retrain_last_success = Gauge("retrain_last_success", "1 if the most recent retrain succeeded, else 0")
retrain_duration_seconds = Gauge("retrain_duration_seconds", "Wall-clock duration of the most recent retrain")
