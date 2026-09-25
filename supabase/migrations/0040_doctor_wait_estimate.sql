-- Per-doctor average service time, for the API/ML wait-estimate model to consume -- the
-- service-level equivalent (analytics.service_time_trend) already exists; this is the same
-- shape, filtered by doctor instead. Same org-scoping rule as every other analytics.* function:
-- org_id is the caller's own, checked by private.check_analytics_org, never trusted as-is.
create function analytics.doctor_service_time(p_org_id uuid, p_doctor_id uuid, p_days int)
returns table (avg_service_minutes numeric, sample_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select private.check_analytics_org(p_org_id);
  select avg(extract(epoch from (t.finished_at - t.serving_at)) / 60), count(*)
  from public.tokens t
  where t.org_id = p_org_id and t.doctor_id = p_doctor_id and t.status = 'done'
    and t.finished_at is not null and t.serving_at is not null
    and t.service_day >= current_date - p_days;
$$;

revoke execute on function analytics.doctor_service_time(uuid, uuid, int) from public, anon;
grant execute on function analytics.doctor_service_time(uuid, uuid, int) to authenticated, queueless_api;
