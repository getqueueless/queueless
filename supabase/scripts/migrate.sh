#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${QUEUELESS_API_DB_PASSWORD:?QUEUELESS_API_DB_PASSWORD must be set}"

PSQL="docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres"

echo "Waiting for auth.jwt() ..."
until $PSQL -tAc "select to_regprocedure('auth.jwt()') is not null" 2>/dev/null | grep -q '^t$'; do
  sleep 1
done

$PSQL -q <<'SQL'
create schema if not exists private;
create table if not exists private.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
SQL

for f in migrations/*.sql; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  applied=$($PSQL -tAc "select 1 from private.schema_migrations where filename = '$name'")
  if [ "$applied" = "1" ]; then
    echo "Skip  $name (already applied)"
    continue
  fi
  echo "Apply $name"
  { cat "$f"; printf "\ninsert into private.schema_migrations(filename) values ('%s');\n" "$name"; } \
    | $PSQL -q -1 -v queueless_api_db_password="$QUEUELESS_API_DB_PASSWORD"
done

$PSQL -q -c "notify pgrst, 'reload schema'"
sleep 2
echo "Migrations applied, schema reload notified."
