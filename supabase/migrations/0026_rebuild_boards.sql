create function private.rebuild_boards(p_org uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  c record;
  v_waiting int;
  v_served int;
  v_no_show int;
  v_last_called_code text;
  v_avg int;
  v_sample_count int;
  v_current_code text;
  v_current_status public.token_status;
begin
  for s in select id, default_service_secs from public.services where org_id = p_org loop
    select count(*) filter (where status = 'waiting'),
           count(*) filter (where status = 'done'),
           count(*) filter (where status = 'no_show')
      into v_waiting, v_served, v_no_show
      from public.tokens
      where service_id = s.id and service_day = p_day;

    select t.code into v_last_called_code
      from public.tokens t
      where t.service_id = s.id and t.service_day = p_day and t.called_at is not null
      order by t.called_at desc limit 1;

    select avg(extract(epoch from (sample.finished_at - sample.serving_at)))::int, count(*)
      into v_avg, v_sample_count
      from (
        select finished_at, serving_at from public.tokens
        where service_id = s.id and status = 'done'
          and finished_at is not null and serving_at is not null
          and extract(epoch from (finished_at - serving_at)) between 30 and 1800
        order by finished_at desc limit 20
      ) sample;
    if v_sample_count is null or v_sample_count < 5 or v_avg is null then
      v_avg := s.default_service_secs;
    end if;

    insert into public.board_services (
      service_id, day, org_id, waiting_count, served_count, no_show_count, last_called_code, avg_service_secs, updated_at
    ) values (
      s.id, p_day, p_org, v_waiting, v_served, v_no_show, v_last_called_code, v_avg, now()
    )
    on conflict (service_id, day) do update set
      waiting_count = excluded.waiting_count,
      served_count = excluded.served_count,
      no_show_count = excluded.no_show_count,
      last_called_code = excluded.last_called_code,
      avg_service_secs = excluded.avg_service_secs,
      updated_at = now();
  end loop;

  for c in select id, name, state from public.counters where org_id = p_org loop
    v_current_code := null;
    v_current_status := null;

    select t.code, t.status into v_current_code, v_current_status
      from public.tokens t
      where t.counter_id = c.id and t.status in ('called', 'serving')
      limit 1;

    insert into public.board_counters (counter_id, org_id, counter_name, state, token_code, token_status, updated_at)
    values (c.id, p_org, c.name, c.state, v_current_code, v_current_status, now())
    on conflict (counter_id) do update set
      counter_name = excluded.counter_name,
      state = excluded.state,
      token_code = excluded.token_code,
      token_status = excluded.token_status,
      updated_at = now();
  end loop;
end;
$$;

revoke execute on function private.rebuild_boards(uuid, date) from public, anon, authenticated;
