#!/usr/bin/env bash
# Run on the VPS: bash /opt/queueless-deploy/web/deploy.sh
set -euo pipefail
REPO=/opt/queueless
HERE="$(cd "$(dirname "$0")" && pwd)"
git -C "$REPO" pull --ff-only
ANON_KEY="$(grep -m1 '^ANON_KEY=' "$REPO/supabase/.env" | cut -d= -f2- | tr -d '"'"'"'"')"
SERVICE_ROLE_KEY="$(grep -m1 '^SERVICE_ROLE_KEY=' "$REPO/supabase/.env" | cut -d= -f2- | tr -d '"'"'"'"')"
SUPABASE_URL=https://sb.lpu.lol
API_BASE_URL=https://api.lpu.lol
SITE_URL=https://lpu.lol
DOCKER_BUILDKIT=1 docker build -t queueless-web -f "$HERE/Dockerfile" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  --build-arg NEXT_PUBLIC_API_BASE_URL="$API_BASE_URL" \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  "$REPO"
docker rm -f ql-web >/dev/null 2>&1 || true
docker run -d --name ql-web --restart unless-stopped --memory 768m --network mcbots_bots \
  -e NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" -e NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  -e NEXT_PUBLIC_API_BASE_URL="$API_BASE_URL" -e NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  queueless-web >/dev/null
echo "ql-web started"
