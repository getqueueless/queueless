-- "Ask your data" safety layer: a dedicated schema of read-only, parameterized, admin-only,
-- org-scoped functions. No dynamic SQL anywhere below -- every WHERE clause is static and every
-- parameter is bound, never concatenated into a query string.
create schema analytics;

revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to authenticated, queueless_api;
alter default privileges in schema analytics revoke execute on functions from public;

-- Org scoping, shared by every function below. Two callers only:
--  - authenticated (an admin using the app): scope comes from their OWN JWT via
--    private.my_role()/private.my_org() -- a caller can never pass an org id and get a
--    different one back.
--  - queueless_api (apps/api generating a scheduled ops_summaries row): it has no JWT and
--    no org of its own. This system has exactly one organization today, so it gets that one.
--    A genuinely multi-org deployment would need queueless_api to supply an explicit org id,
--    checked against something it's allowed to read -- not built, because there is only one
--    organization to be wrong about right now.
-- session_user (not current_user) is what identifies the real login role here: SECURITY DEFINER
-- makes current_user the function owner (postgres) for the whole call, but session_user stays
-- whoever actually opened the connection.
create function private.analytics_org()
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if session_user = 'queueless_api' then
    select id into v_org from public.organizations order by created_at limit 1;
    return v_org;
  end if;

  -- IS DISTINCT FROM, not <>: private.my_role() is NULL for a caller with no profile row,
  -- and `if null <> 'admin' then` is false in plpgsql (NULL is not TRUE), which would let a
  -- caller with no admin role straight through. IS DISTINCT FROM treats NULL as not-admin.
  if private.my_role() is distinct from 'admin' then
    perform private.fail(403, 'forbidden', 'Admins only');
  end if;

  return private.my_org();
end;
$$;

revoke execute on function private.analytics_org() from public, anon, authenticated, queueless_api;

-- 1. Did we lose patients to no-shows, and where.
create function analytics.no_shows_by_service(p_from date, p_to date)
returns table (service_id uuid, service_name text, total_tokens bigint, no_show_count bigint, no_show_rate numeric)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.name,
         count(t.id),
         count(t.id) filter (where t.status = 'no_show'),
         round(
           count(t.id) filter (where t.status = 'no_show')::numeric
             / nullif(count(t.id), 0), 4
         )
  from public.services s
  left join public.tokens t
    on t.service_id = s.id and t.service_day between p_from and p_to
  where s.org_id = private.analytics_org()
  group by s.id, s.name
  order by s.name;
$$;

-- 2. When do people actually wait longest, for one service.
create function analytics.avg_wait_by_hour(p_service uuid, p_from date, p_to date)
returns table (hour smallint, avg_wait_minutes numeric, sample_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select extract(hour from (t.created_at at time zone o.timezone))::smallint,
         round(avg(extract(epoch from (t.called_at - t.created_at)) / 60.0)::numeric, 1),
         count(*)
  from public.tokens t
  join public.services s on s.id = t.service_id
  join public.organizations o on o.id = s.org_id
  where s.org_id = private.analytics_org()
    and t.service_id = p_service
    and t.service_day between p_from and p_to
    and t.called_at is not null
  group by 1
  order by 1;
$$;

-- 3. Which desks actually carried the load on one day.
create function analytics.busiest_counters(p_day date)
returns table (counter_id uuid, counter_name text, tokens_served bigint, avg_service_secs numeric)
language sql
security definer
stable
set search_path = ''
as $$
  select c.id, c.name,
         count(t.id) filter (where t.status = 'done') as tokens_served,
         round(avg(extract(epoch from (t.finished_at - t.serving_at)))
           filter (where t.status = 'done')::numeric, 0) as avg_service_secs
  from public.counters c
  left join public.tokens t
    on t.counter_id = c.id and t.service_day = p_day
  where c.org_id = private.analytics_org()
  group by c.id, c.name
  order by tokens_served desc nulls last;
$$;

-- 4. Daily volume, chart-ready: every day in range appears even with zero tokens.
create function analytics.tokens_per_day(p_from date, p_to date)
returns table (day date, tokens_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select d.day, count(t.id)
  from generate_series(p_from, p_to, interval '1 day') as d(day)
  left join public.tokens t
    on t.service_day = d.day::date and t.org_id = private.analytics_org()
  group by d.day
  order by d.day;
$$;

-- 5. Is one service's average visit getting slower or faster, day by day.
create function analytics.service_time_trend(p_service uuid, p_days int)
returns table (day date, avg_service_secs numeric, sample_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select t.service_day,
         round(avg(extract(epoch from (t.finished_at - t.serving_at)))::numeric, 0),
         count(*)
  from public.tokens t
  join public.services s on s.id = t.service_id
  where s.org_id = private.analytics_org()
    and t.service_id = p_service
    and t.status = 'done'
    and t.service_day >= private.service_day(private.analytics_org(), now()) - greatest(p_days, 1) + 1
  group by t.service_day
  order by t.service_day;
$$;

-- 6. Actual wait, per service per day, in range. NOTE: this DB has no stored "predicted wait" --
-- predictions are computed live by apps/api's model and never persisted. This returns the actual
-- half only; a real "vs predicted" comparison has to join this against a live prediction call at
-- the app layer. Naming it wait_vs_predicted (as asked) but not fabricating a predicted column.
create function analytics.wait_vs_predicted(p_from date, p_to date)
returns table (service_id uuid, service_name text, day date, avg_actual_wait_secs numeric, sample_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.name, t.service_day,
         round(avg(extract(epoch from (t.called_at - t.created_at)))::numeric, 0),
         count(*)
  from public.tokens t
  join public.services s on s.id = t.service_id
  where s.org_id = private.analytics_org()
    and t.service_day between p_from and p_to
    and t.called_at is not null
  group by s.id, s.name, t.service_day
  order by s.name, t.service_day;
$$;

-- 7. Full 24h profile of arrivals in range -- every hour present, chart-ready.
create function analytics.peak_hours(p_from date, p_to date)
returns table (hour smallint, tokens_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  with org as (
    select o.id, o.timezone from public.organizations o where o.id = private.analytics_org()
  )
  select h.hour, count(t.id)
  from generate_series(0, 23) as h(hour)
  cross join org
  left join public.tokens t
    on t.org_id = org.id
   and t.service_day between p_from and p_to
   and extract(hour from (t.created_at at time zone org.timezone))::smallint = h.hour
  group by h.hour
  order by h.hour;
$$;

-- 8. Priority-lane mix in range, as a share of total.
create function analytics.lane_mix(p_from date, p_to date)
returns table (lane public.lane, tokens_count bigint, pct numeric)
language sql
security definer
stable
set search_path = ''
as $$
  select t.lane, count(*) as tokens_count,
         round(count(*)::numeric / nullif(sum(count(*)) over (), 0) * 100, 1) as pct
  from public.tokens t
  where t.org_id = private.analytics_org()
    and t.service_day between p_from and p_to
  group by t.lane
  order by tokens_count desc;
$$;

-- Written out one at a time, not looped with EXECUTE format(...): this schema's whole point is
-- no dynamic SQL, and that applies to its own bootstrapping too, not just the data-access functions.
revoke execute on function analytics.no_shows_by_service(date, date) from public, anon;
grant execute on function analytics.no_shows_by_service(date, date) to authenticated, queueless_api;

revoke execute on function analytics.avg_wait_by_hour(uuid, date, date) from public, anon;
grant execute on function analytics.avg_wait_by_hour(uuid, date, date) to authenticated, queueless_api;

revoke execute on function analytics.busiest_counters(date) from public, anon;
grant execute on function analytics.busiest_counters(date) to authenticated, queueless_api;

revoke execute on function analytics.tokens_per_day(date, date) from public, anon;
grant execute on function analytics.tokens_per_day(date, date) to authenticated, queueless_api;

revoke execute on function analytics.service_time_trend(uuid, int) from public, anon;
grant execute on function analytics.service_time_trend(uuid, int) to authenticated, queueless_api;

revoke execute on function analytics.wait_vs_predicted(date, date) from public, anon;
grant execute on function analytics.wait_vs_predicted(date, date) to authenticated, queueless_api;

revoke execute on function analytics.peak_hours(date, date) from public, anon;
grant execute on function analytics.peak_hours(date, date) to authenticated, queueless_api;

revoke execute on function analytics.lane_mix(date, date) from public, anon;
grant execute on function analytics.lane_mix(date, date) to authenticated, queueless_api;
