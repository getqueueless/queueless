# Queueless monitoring stack

Prometheus + Grafana + postgres_exporter + Alertmanager, memory-limited to <=384MB
total (see `docker-compose.yml`'s header comment for the per-service breakdown).

## Verified this session (real, not just written)

Brought the full stack up locally with dummy credentials: all 4 containers started
and passed health checks (`docker compose ps` → all healthy), real measured memory
at idle was ~130MB of the 384MB budget (Prometheus 28MB, Grafana 74MB, postgres_
exporter 10MB, Alertmanager 20MB), all 4 alert rules loaded into Prometheus with
`"health":"ok"`, the Prometheus datasource auto-provisioned correctly in Grafana,
and both dashboards (`queueless-live-ops`, `queueless-api-health`) loaded with every
panel rendering under their real titles — confirmed via the browser pane, not just
by reading the JSON. They showed "No data" honestly, since no real `ql-api` was
running to scrape in that verification pass — not a bug, just nothing to show yet.
Screenshots were viewed live in-session but not saved as files in this repo (they'd
go stale the moment this actually deploys against a live API; the provisioned
dashboard JSON is the real, durable artifact).

## Run it

```bash
cd deploy/monitoring
cp .env.example .env   # fill in real values -- see below, never commit .env
docker compose up -d
docker compose ps      # all 4 should report healthy within ~15s
```

Prometheus: `http://localhost:9090` · Grafana: `http://localhost:3001` (or your
`GRAFANA_PORT`) · Alertmanager: `http://localhost:9093`.

## Environment variables (`.env`, gitignored — never commit)

| Variable | What it is |
|---|---|
| `QL_API_TARGET` | `host:port` where apps/api's `/metrics` is actually reachable from this compose network (`host.docker.internal:8000` for "same host, outside this network") |
| `POSTGRES_EXPORTER_DSN` | Postgres connection string for a **read-only** role — see `docs/DECISIONS.md` for the exact `CREATE ROLE`/`GRANT` the DB agent needs to add; never `queueless_api` and never `postgres` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Real SMTP creds for `noreply@lpu.lol` — Alertmanager's own config file (`alertmanager/alertmanager.yml`) does **not** auto-expand these; see that file's header comment for why and what the deploy session needs to do |
| `ALERT_EMAIL_TO` | Where alert emails go |
| `GRAFANA_ADMIN_PASSWORD` | Real admin password — never the image default |
| `PROMETHEUS_PORT` / `GRAFANA_PORT` / `ALERTMANAGER_PORT` / `POSTGRES_EXPORTER_PORT` | Optional port overrides |

## Admin-only exposure

This stack binds to plain host ports with no auth in front by default (Grafana has
its own login, Prometheus/Alertmanager have none). The deploy session is expected to
put Grafana behind Caddy at an admin-only URL (auth/allowlist at the edge) and NOT
expose Prometheus (`9090`) or Alertmanager (`9093`) publicly at all — bind those to
`127.0.0.1` on the VPS or firewall them, since they have no login of their own.

## Alert rules

`prometheus/alert-rules.yml`: API down (`up{job="ql-api"} == 0`, 1m), error rate over
5% (`http_requests_total{status=~"5.."}` ratio, 5m — metric names verified against
the installed `prometheus-fastapi-instrumentator`'s own source, not guessed), queue
depth over 20 waiting for 5m+ (a starting threshold, not a learned baseline — tune
once real traffic exists), and p95 notification delivery lag over 60s for 5m+.

## Request-id correlation

Already built, not new this task: `app/middleware.py::RequestIDMiddleware` binds
`request_id` into every `structlog` log line for that request via `structlog.
contextvars`, and echoes it back as the `x-request-id` response header (reusing a
client-supplied one if present). To correlate a Grafana-surfaced error with its full
log trail: take the `x-request-id` from the failing response (or your own tracing
tool), `grep` it in the JSON logs.
