from prometheus_client import Gauge

queue_depth = Gauge("queue_depth", "Waiting tokens per service", ["service"])
