#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

PSQL="docker exec -i supabase-db psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres"

$PSQL -c "create extension if not exists pgtap with schema extensions" >/dev/null

for f in tests/*.test.sql; do
  [ -e "$f" ] || continue
  echo "=== $f ==="
  if ! $PSQL -f "$f"; then
    echo "FAIL $f"
    exit 1
  fi
done

echo "All tests passed."
