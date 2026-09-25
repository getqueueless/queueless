create function private.tokens_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiting int;
  v_served int;
  v_no_show int;
  v_last_called_code text;
  v_avg int;
  v_default_secs int;
  v_sample_count int;
  v_top3 uuid[];
begin
  select default_service_secs into v_default_secs from public.services where id = new.service_id;

  select count(*) filter (where status = 'waiting'),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'no_show')
    into v_waiting, v_served, v_no_show
    from public.tokens
    where service_id = new.service_id and service_day = new.service_day;

  select t.code into v_last_called_code
    from public.tokens t
    where t.service_id = new.service_id and t.service_day = new.service_day and t.called_at is not null
    order by t.called_at desc limit 1;

  v_avg := null;
  if new.status = 'done' then
    select avg(extract(epoch from (sample.finished_at - sample.serving_at)))::int, count(*)
      into v_avg, v_sample_count
      from (
        select finished_at, serving_at from public.tokens
        where service_id = new.service_id and status = 'done'
          and finished_at is not null and serving_at is not null
          and extract(epoch from (finished_at - serving_at)) between 30 and 1800
        order by finished_at desc limit 20
      ) sample;
    if v_sample_count is null or v_sample_count < 5 or v_avg is null then
      v_avg := v_default_secs;
    end if;
  end if;

  insert into public.board_services (
    service_id, day, org_id, waiting_count, served_count, no_show_count, last_called_code, avg_service_secs, updated_at
  ) values (
    new.service_id, new.service_day, new.org_id, v_waiting, v_served, v_no_show,
    v_last_called_code, coalesce(v_avg, v_default_secs), now()
  )
  on conflict (service_id, day) do update set
    waiting_count = excluded.waiting_count,
    served_count = excluded.served_count,
    no_show_count = excluded.no_show_count,
    last_called_code = coalesce(excluded.last_called_code, board_services.last_called_code),
    avg_service_secs = case when new.status = 'done' then excluded.avg_service_secs else board_services.avg_service_secs end,
    updated_at = now();

  if new.counter_id is not null then
    update public.board_counters
      set token_code = new.code, token_status = new.status, updated_at = now()
      where counter_id = new.counter_id;
  end if;

  if new.patient_id is not null and new.status = 'called' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notifications (patient_id, token_id, kind, title, body)
    values (
      new.patient_id, new.id, 'called', 'You''re being called',
      'Please proceed to ' || coalesce((select name from public.counters where id = new.counter_id), 'the counter')
    )
    on conflict do nothing;
  end if;

  if new.status = 'waiting' then
    select array_agg(t.id) into v_top3 from (
      select id from public.tokens
      where service_id = new.service_id and service_day = new.service_day and status = 'waiting'
      order by lane_rank, priority_at, number
      limit 3
    ) t;
    if new.patient_id is not null and new.id = any(v_top3) then
      insert into public.notifications (patient_id, token_id, kind, title, body)
      values (new.patient_id, new.id, 'almost_turn', 'You''re almost up', 'You are in the top 3 for your turn')
      on conflict do nothing;
    end if;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, old, new)
  values (new.org_id, 'tokens', new.id, tg_op, to_jsonb(old), to_jsonb(new));

  return new;
end;
$$;

create trigger tokens_after_write
  after insert or update on public.tokens
  for each row execute function private.tokens_after_write();
