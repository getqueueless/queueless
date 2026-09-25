-- "Ask your data" safety layer for /admin/ask and the daily ops summary. No dynamic SQL
-- anywhere below -- every WHERE clause is static and every parameter is bound, never
-- concatenated into a query string.
--
-- Signatures below were rewritten to match apps/api's ALREADY LANDED, ALREADY TESTED caller
-- exactly (app/analytics.py's ANALYTICS_FUNCTIONS whitelist, and the fixture it was built and
-- tested against, apps/api/scripts/dev_db.py) -- discovered via `git pull --rebase` mid-task:
-- apps/api and apps/web have been building against an assumed contract while this schema
-- didn't exist yet. Matching that contract, not the original task wording, is what actually
-- makes /admin/ask and the daily summary work end to end. Concretely this means: org_id is
-- the function's own first positional argument (apps/api's call_analytics injects the
-- caller's server-looked-up org_id there, never a client-suppliable param -- proven in its own
-- tests/test_analytics.py::test_org_scoping_cannot_be_overridden_by_param), most functions take
-- a single p_day rather than a date range, and every output column name matches the fixture's
-- RETURNS TABLE exactly (dev_db.py's SCHEMA_SQL is the authoritative shape).
create schema analytics;

revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to authenticated, queueless_api;
alter default privileges in schema analytics revoke execute on functions from public;

-- Called at the top of every function below. Two trusted paths:
--  - queueless_api (apps/api): already does its own whitelisting and server-side org lookup
--    before ever building this call: trust the p_org_id it passes.
--  - authenticated: must be an admin of EXACTLY the org they passed -- p_org_id is a real
--    argument here (unlike the original private.analytics_org() design), so without this check
--    any signed-in user could pass any org's id and read its analytics directly through
--    PostgREST. This is what keeps a raw-org-id-as-parameter function safe for a JWT caller.
-- session_user (not current_user): SECURITY DEFINER makes current_user the function owner
-- (postgres) for the whole call, so current_user can never tell callers apart; session_user is
-- fixed for the life of the connection and does. Can't be exercised by pgTAP for that reason
-- (SET ROLE changes current_user, never session_user) -- verified with a real direct
-- connection instead, see supabase/README.md.
create function private.check_analytics_org(p_org_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if session_user = 'queueless_api' then
    return;
  end if;

  -- IS DISTINCT FROM, not <>/=: private.my_role()/my_org() are NULL for a caller with no
  -- profile row, and `if null <> 'admin' then`/`if null = p_org_id then` are both false in
  -- plpgsql (NULL is not TRUE), which would let such a caller straight through either check.
  if private.my_role() is distinct from 'admin' or private.my_org() is distinct from p_org_id then
    perform private.fail(403, 'forbidden', 'Admins only');
  end if;
end;
$$;

revoke execute on function private.check_analytics_org(uuid) from public, anon, authenticated, queueless_api;

-- 1. No-show counts per service for one day.
create function analytics.no_shows_by_service(p_org_id uuid, p_day date)
returns table (service_id uuid, no_show_count bigint, total_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select t.service_id,
         count(*) filter (where t.status = 'no_show') as no_show_count,
         count(*) as total_count
  from public.tokens t
  where t.org_id = p_org_id and t.service_day = p_day
  group by t.service_id;
$$;

-- 2. Average wait in minutes by hour of day, org-wide (not per service).
create function analytics.avg_wait_by_hour(p_org_id uuid, p_day date)
returns table (hour int, avg_wait_minutes numeric)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select extract(hour from t.created_at)::int as hour,
         avg(extract(epoch from (t.called_at - t.created_at)) / 60) as avg_wait_minutes
  from public.tokens t
  where t.org_id = p_org_id and t.service_day = p_day and t.called_at is not null
  group by 1;
$$;

-- 3. Tokens served per counter for one day.
create function analytics.busiest_counters(p_org_id uuid, p_day date)
returns table (counter_id uuid, served_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select t.counter_id, count(*) as served_count
  from public.tokens t
  where t.org_id = p_org_id and t.service_day = p_day
    and t.status = 'done' and t.counter_id is not null
  group by t.counter_id;
$$;

-- 4. Token volume per day across a range.
create function analytics.tokens_per_day(p_org_id uuid, p_start_day date, p_end_day date)
returns table (day date, token_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select t.service_day as day, count(*) as token_count
  from public.tokens t
  where t.org_id = p_org_id and t.service_day between p_start_day and p_end_day
  group by t.service_day
  order by t.service_day;
$$;

-- 5. Average service time trend for one service over the last N days.
create function analytics.service_time_trend(p_org_id uuid, p_service_id uuid, p_days int)
returns table (day date, avg_service_minutes numeric)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select t.service_day as day,
         avg(extract(epoch from (t.finished_at - t.serving_at)) / 60) as avg_service_minutes
  from public.tokens t
  where t.org_id = p_org_id and t.service_id = p_service_id and t.status = 'done'
    and t.finished_at is not null and t.serving_at is not null
    and t.service_day >= current_date - p_days
  group by t.service_day
  order by t.service_day;
$$;

-- 6. Actual wait per token, one day. NOTE: this DB never stores a predicted wait --
-- predictions are computed live by apps/api's model and never persisted. This is the actual
-- half only; "vs predicted" is joined at the app layer, per-token, against a live /predict call.
create function analytics.wait_vs_predicted(p_org_id uuid, p_day date)
returns table (token_id uuid, actual_wait_minutes numeric)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select t.id as token_id, extract(epoch from (t.called_at - t.created_at)) / 60 as actual_wait_minutes
  from public.tokens t
  where t.org_id = p_org_id and t.service_day = p_day and t.called_at is not null;
$$;

-- 7. Token volume by hour of day, one day.
create function analytics.peak_hours(p_org_id uuid, p_day date)
returns table (hour int, token_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select extract(hour from t.created_at)::int as hour, count(*) as token_count
  from public.tokens t
  where t.org_id = p_org_id and t.service_day = p_day
  group by 1
  order by 1;
$$;

-- 8. Token counts by lane_rank (0 = emergency, 1 = everything else -- coarser than the full
-- `lane` enum on purpose, matching apps/api's already-tested fixture exactly).
create function analytics.lane_mix(p_org_id uuid, p_day date)
returns table (lane_rank smallint, token_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select t.lane_rank, count(*) as token_count
  from public.tokens t
  where t.org_id = p_org_id and t.service_day = p_day
  group by t.lane_rank
  order by t.lane_rank;
$$;

-- Written out one at a time, not looped with EXECUTE format(...): this schema's whole point is
-- no dynamic SQL, and that applies to its own bootstrapping too, not just the data-access functions.
revoke execute on function analytics.no_shows_by_service(uuid, date) from public, anon;
grant execute on function analytics.no_shows_by_service(uuid, date) to authenticated, queueless_api;

revoke execute on function analytics.avg_wait_by_hour(uuid, date) from public, anon;
grant execute on function analytics.avg_wait_by_hour(uuid, date) to authenticated, queueless_api;

revoke execute on function analytics.busiest_counters(uuid, date) from public, anon;
grant execute on function analytics.busiest_counters(uuid, date) to authenticated, queueless_api;

revoke execute on function analytics.tokens_per_day(uuid, date, date) from public, anon;
grant execute on function analytics.tokens_per_day(uuid, date, date) to authenticated, queueless_api;

revoke execute on function analytics.service_time_trend(uuid, uuid, int) from public, anon;
grant execute on function analytics.service_time_trend(uuid, uuid, int) to authenticated, queueless_api;

revoke execute on function analytics.wait_vs_predicted(uuid, date) from public, anon;
grant execute on function analytics.wait_vs_predicted(uuid, date) to authenticated, queueless_api;

revoke execute on function analytics.peak_hours(uuid, date) from public, anon;
grant execute on function analytics.peak_hours(uuid, date) to authenticated, queueless_api;

revoke execute on function analytics.lane_mix(uuid, date) from public, anon;
grant execute on function analytics.lane_mix(uuid, date) to authenticated, queueless_api;
