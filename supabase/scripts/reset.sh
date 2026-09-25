#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

docker compose -f docker-compose.yml down -v
docker compose -f docker-compose.yml up -d --wait db auth
docker compose -f docker-compose.yml up -d --wait
docker compose -f docker-compose.yml ps
