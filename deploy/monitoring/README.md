# WaitWise monitoring stack

Prometheus + Grafana + postgres_exporter + Alertmanager, memory-limited to <=384MB
total, well under the 1GB budget (see `docker-compose.yml`'s header comment for the
per-service breakdown). Every host port binds `127.0.0.1` only; postgres_exporter and
Alertmanager publish no host port at all. Grafana and Prometheus also join the shared
`mcbots_bots` network (same one `ql-api`/`ql-web` use) so Caddy can reach them by
container name with no host port involved either.

## Verified this session (real, not just written)

Brought the full stack up with dummy credentials and the real network topology
(created throwaway `mcbots_bots` + used the already-running `queueless_default`
locally): all 4 containers started and passed health checks (`docker compose ps` →
Prometheus and Grafana `healthy`, postgres_exporter/Alertmanager have no healthcheck
of their own), real measured memory at idle was ~206MB of the 384MB budget
(Prometheus 75MB, Grafana 109MB, postgres_exporter 13MB, Alertmanager 9MB), all 4
port bindings confirmed `127.0.0.1:<port>->...` via `docker port` (never `0.0.0.0`),
`docker inspect` confirmed Prometheus + Grafana on `mcbots_bots`, postgres_exporter
on `queueless_default`, Alertmanager on neither, and all 4 alert rules loaded into
Prometheus with `"health":"ok"`. Dashboards (`queueless-live-ops`,
`queueless-api-health`) were verified rendering in an earlier pass this session (see
git history) — not re-checked this time since nothing about their JSON changed, only
the network/port wiring around them. Screenshots were viewed live in-session but not
saved as files in this repo (they'd go stale the moment this actually deploys against
a live API; the provisioned dashboard JSON is the real, durable artifact). Torn down
after (`docker compose down -v`, throwaway `mcbots_bots` network removed); the
already-running `queueless_default` network and its real supabase containers were
never touched.

## Bring-up on the VPS (infra's job — steps for whoever runs this)

```bash
cd /opt/queueless/deploy/monitoring

# 1. mcbots_bots must already exist (ql-api/ql-web create it) -- confirm, don't create:
docker network inspect mcbots_bots >/dev/null || echo "mcbots_bots missing -- deploy ql-api/ql-web first"

# 2. queueless_default must already exist (the supabase stack creates it):
docker network inspect queueless_default >/dev/null || echo "queueless_default missing -- bring up supabase/docker-compose.yml first"

# 3. Real env -- see the table below. Never commit this file.
cp .env.example .env
$EDITOR .env

# 4. Up, then confirm all 4 healthy:
docker compose up -d
docker compose ps

# 5. Sanity check from the VPS itself (these are 127.0.0.1-only, so this only works
#    run ON the VPS, or over an SSH tunnel -- see "Admin-only exposure" below):
curl -sf http://127.0.0.1:9090/-/healthy && echo prometheus-ok
curl -sf http://127.0.0.1:3001/api/health && echo grafana-ok

# 6. Point Caddy at the admin-only Grafana URL (container-to-container, no host port
#    needed): reverse_proxy to queueless-grafana:3000 over the mcbots_bots network,
#    same pattern Caddy already uses for ql-api/ql-web. Not this repo's Caddyfile to
#    write -- infra's own Caddy config, on the VPS.
```

Local dev (not the VPS): `cd deploy/monitoring && cp .env.example .env && docker
compose up -d` still works the same way, reachable at `http://localhost:9090` /
`http://localhost:3001` since `127.0.0.1` is `localhost` on your own machine.

## Environment variables (`.env`, gitignored — never commit)

| Variable | What it is |
|---|---|
| `POSTGRES_EXPORTER_DSN` | Postgres connection string for a **read-only** role — see `docs/DECISIONS.md` for the exact `CREATE ROLE`/`GRANT` the DB agent needs to add; never `queueless_api` and never `postgres` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Real SMTP creds for `noreply@lpu.lol` — Alertmanager's own config file (`alertmanager/alertmanager.yml`) does **not** auto-expand these; see that file's header comment for why and what the deploy session needs to do |
| `ALERT_EMAIL_TO` | Where alert emails go |
| `GRAFANA_ADMIN_PASSWORD` | Real admin password — never the image default |
| `PROMETHEUS_PORT` / `GRAFANA_PORT` | Optional 127.0.0.1 host-port overrides (Alertmanager/postgres_exporter publish no host port at all, nothing to override) |

The `ql-api` scrape target is a literal `ql-api:8000` directly in
`prometheus/prometheus.yml`, not a `.env` variable — found live on the VPS:
Prometheus's own config has no env-var substitution at all, so
`${QL_API_TARGET:-ql-api:8000}` (this file's own earlier mistake) was
scraping a literal, unexpanded string and showing `ql-api` permanently
`DOWN`. To point at a different target, edit that line directly.

## Admin-only exposure

Enforced in `docker-compose.yml`, not just a recommendation: every published host
port binds `127.0.0.1` only (Prometheus, Grafana), and postgres_exporter /
Alertmanager publish no host port at all — neither has a login of its own, so
nothing about them is reachable except from the VPS's own loopback or another
container on `mcbots_bots`/`queueless_default`. Grafana does have its own login
(`GRAFANA_ADMIN_PASSWORD`), and additionally joins `mcbots_bots` so Caddy can front
it at an admin-only URL (auth/allowlist at the edge — the deploy session's Caddyfile,
not built here) without opening any port on the host at all. To reach Prometheus's
own UI for debugging, SSH-tunnel instead of opening a port:
`ssh -L 9090:127.0.0.1:9090 <vps>`.

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
