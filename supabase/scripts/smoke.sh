#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a
. ./.env
set +a

BASE="http://localhost:${KONG_HTTP_PORT:-8000}"
fail=0

check() {
  desc="$1"; expected="$2"; got="$3"
  if [ "$got" = "$expected" ]; then
    echo "OK   $desc -> $got"
  else
    echo "FAIL $desc -> got $got, expected $expected"
    fail=1
  fi
}

got=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/auth/v1/health" -H "apikey: $ANON_KEY")
check "GET /auth/v1/health (anon)" 200 "$got"

got=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/rest/v1/" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
check "GET /rest/v1/ (service_role, admin-only OpenAPI root)" 200 "$got"

got=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/realtime/v1/api/tenants" -H "apikey: $ANON_KEY")
check "GET /realtime/v1/api/tenants (anon, should be blocked)" 403 "$got"

if [ "${1:-}" = "--post-migrate" ]; then
  got=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/rest/v1/board_services?select=service_id&limit=1" -H "apikey: $ANON_KEY")
  check "GET /rest/v1/board_services (anon, post-migration)" 200 "$got"
fi

exit $fail
