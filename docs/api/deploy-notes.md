# apps/api deploy notes

## `/health` vs `/ready`

- `GET /health` — liveness only, no I/O. This is what the Dockerfile's `HEALTHCHECK`
  targets. A DB hiccup must never restart an otherwise-healthy process, so this endpoint
  never touches the database.
- `GET /ready` — readiness. Actually runs `SELECT 1` against Postgres; returns 503 while
  starting up, during a DB outage, or once shutdown has begun. This is what a load
  balancer or rollout gate should watch — never wire a container's own restart policy to
  this endpoint, or a DB blip restarts a fleet that didn't need restarting.

## Graceful shutdown ordering (already implemented in `app/main.py`)

On shutdown, in this order:

1. `app.state.shutting_down = True` — `/ready` starts returning 503 immediately, before
   anything else happens, so a load balancer has a chance to stop routing new traffic in.
2. The scheduler, LISTEN, and polling background tasks are cancelled and awaited.
3. The asyncpg pool is closed.

The Dockerfile's `CMD` passes `uvicorn ... --timeout-graceful-shutdown 30`, so uvicorn
gives in-flight requests up to 30s to finish before force-closing. Docker's own default
`stop_grace_period` is 10s — shorter than that 30s timer — so it will SIGKILL the
container before uvicorn's own graceful window finishes unless whoever wires this
container up raises it to match. Editing the root `supabase/docker-compose.yml` (or any
other root compose file) is out of `apps/api`'s scope, so here is the snippet to add
wherever this image ends up composed in:

```yaml
  api:
    image: queueless-api:latest
    ports:
      - "8001:8001"
    env_file: .env  # secrets-managed, never committed
    stop_grace_period: 30s
```

## Port

The service listens on `8001`, not `8000` — Kong (the self-hosted Supabase API gateway)
already owns `8000` on this box.
