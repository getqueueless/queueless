# Decisions log

One line per deviation from the plan/spec, with why.

- 2026-09-25: Added `TENANT_MAX_CONCURRENT_USERS: 2000` to the realtime service in
  `supabase/docker-compose.yml`. The kit's `TENANT_MAX_EVENTS_PER_SECOND` was already set
  but this sibling tenant-seeding variable was missing, leaving the realtime tenant on its
  default 200-connection cap. Added to match the spec's stated invariant and avoid a silent
  connection cap on demo day.
