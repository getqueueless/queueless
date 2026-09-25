#!/usr/bin/env bash
# Idempotent deploy of apps/api as container ql-api. Run on the VPS.
set -euo pipefail
REPO=/opt/queueless
ENV_OUT=/opt/queueless-deploy/api.env
PORT=8000   # caddy routes api.lpu.lol -> ql-api:8000

git -C "$REPO" pull --ff-only
docker build -t queueless-api "$REPO/apps/api"

# Read secrets without echoing them.
get() { grep -m1 "^$1=" "$REPO/supabase/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
PGPASS=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$(get QUEUELESS_API_DB_PASSWORD)")
DB="postgresql://queueless_api:${PGPASS}@supabase-db:5432/postgres"

sudo mkdir -p "$(dirname "$ENV_OUT")"
sudo chown "$(id -u):$(id -g)" "$(dirname "$ENV_OUT")"
umask 077
cat > "$ENV_OUT" <<ENV
SUPABASE_JWT_SECRET=$(get JWT_SECRET)
DATABASE_URL=$DB
DATABASE_URL_DIRECT=$DB
CORS_ALLOW_ORIGINS=["https://lpu.lol","https://www.lpu.lol"]
ENVIRONMENT=production
ENV
chmod 600 "$ENV_OUT"

docker rm -f ql-api >/dev/null 2>&1 || true
# Image CMD/HEALTHCHECK use port 8001; override to 8000 to match caddy.
docker create --name ql-api --restart unless-stopped --memory 512m \
  --env-file "$ENV_OUT" --network mcbots_bots \
  --health-cmd "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:$PORT/health')\"" \
  --health-interval 30s --health-timeout 3s --health-retries 3 --health-start-period 20s \
  queueless-api uvicorn app.main:app --host 0.0.0.0 --port $PORT --timeout-graceful-shutdown 30
docker network connect queueless_default ql-api
docker start ql-api >/dev/null

for _ in $(seq 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' ql-api)
  [ "$s" = healthy ] && { echo "ql-api healthy"; exit 0; }
  [ "$(docker inspect -f '{{.State.Running}}' ql-api)" = true ] || break
  sleep 2
done
docker logs --tail 50 ql-api; echo "ql-api not healthy"; exit 1
