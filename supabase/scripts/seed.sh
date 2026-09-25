#!/bin/sh
# Idempotent demo seed: accounts (via GoTrue admin API) + org/services/counters/appointment
# slots + 14 days of synthetic history, then hands off to demo-reset.sh for today's live queue.
# Safe to rerun any number of times.
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

BASE="http://localhost:${KONG_HTTP_PORT:-8000}"
DEMO_ENV=".env.demo"
PSQL="docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres"

touch "$DEMO_ENV"
chmod 600 "$DEMO_ENV"

# Extract a "id":"<uuid>" value from a JSON blob (no jq on the VPS).
extract_id() {
  grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Reuse a password for $1 (an UPPER_SNAKE key) from .env.demo, or generate + persist a new one.
get_password() {
  key="$1"
  existing=$(grep "^${key}=" "$DEMO_ENV" 2>/dev/null | tail -1 | cut -d= -f2-)
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
  else
    pw=$(openssl rand -base64 18)
    printf '%s=%s\n' "$key" "$pw" >> "$DEMO_ENV"
    printf '%s' "$pw"
  fi
}

# Find an existing user's id by email (GoTrue's admin list endpoint has no server-side email
# filter, and there's no jq on the VPS to filter client-side JSON precisely) -- split on
# top-level object boundaries, grep the one with the matching email, pull its id.
find_user_id() {
  email="$1"
  curl -sS "$BASE/auth/v1/admin/users?per_page=1000" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    | sed 's/},{"id"/}\n{"id"/g' \
    | grep "\"email\":\"${email}\"" \
    | head -1 \
    | extract_id
}

# Create the user, or recover its id if the email already exists. Prints the id.
create_or_get_user() {
  email="$1"
  password="$2"
  code=$(curl -sS -o /tmp/queueless-seed-resp.json -w '%{http_code}' -X POST "$BASE/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"email_confirm\":true}")
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    extract_id < /tmp/queueless-seed-resp.json
  else
    id=$(find_user_id "$email")
    if [ -z "$id" ]; then
      echo "seed.sh: could not create or find user $email (HTTP $code):" >&2
      cat /tmp/queueless-seed-resp.json >&2
      exit 1
    fi
    printf '%s' "$id"
  fi
  rm -f /tmp/queueless-seed-resp.json
}

seed_account() {
  email="$1"
  key="$2"
  pw=$(get_password "$key")
  create_or_get_user "$email" "$pw" >/dev/null
}

echo "Seeding accounts..."
seed_account admin@lpu.lol ADMIN_PASSWORD
seed_account counter1@lpu.lol COUNTER1_PASSWORD
seed_account counter2@lpu.lol COUNTER2_PASSWORD
seed_account counter3@lpu.lol COUNTER3_PASSWORD

n=1
while [ "$n" -le 30 ]; do
  padded=$(printf '%02d' "$n")
  seed_account "patient${padded}@example.test" "PATIENT${padded}_PASSWORD"
  n=$((n + 1))
done

echo "Applying org/services/counters/appointment-slots config and history..."
$PSQL -q -1 < seed/city_hospital.sql

echo "Resetting today's live queue..."
sh scripts/demo-reset.sh

echo "Seed complete. Summary:"
$PSQL -tA -F' | ' -c "
  select 'organizations', count(*)::text from public.organizations where slug = 'city-hospital'
  union all select 'services', count(*)::text from public.services s join public.organizations o on o.id = s.org_id where o.slug = 'city-hospital'
  union all select 'counters', count(*)::text from public.counters c join public.organizations o on o.id = c.org_id where o.slug = 'city-hospital'
  union all select 'appointment_slots', count(*)::text from public.appointment_slots a join public.services s on s.id = a.service_id join public.organizations o on o.id = s.org_id where o.slug = 'city-hospital'
  union all select 'history tokens (before today)', count(*)::text from public.tokens t join public.organizations o on o.id = t.org_id where o.slug = 'city-hospital' and t.service_day < private.service_day(o.id, now())
  union all select 'today live tokens', count(*)::text from public.tokens t join public.organizations o on o.id = t.org_id where o.slug = 'city-hospital' and t.service_day = private.service_day(o.id, now());
"
echo "Demo accounts and passwords: supabase/.env.demo (gitignored)"
