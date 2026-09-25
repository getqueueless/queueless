create function public.my_queue_status(p_token uuid)
returns table (
  code text,
  status public.token_status,
  service_name text,
  "position" int,
  ahead int,
  eta_seconds int,
  counter_name text,
  called_at timestamptz,
  no_show_deadline timestamptz,
  recall_count smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token public.tokens;
  v_is_authorized boolean;
  v_ahead int;
  v_open_counters int;
  v_avg_secs int;
begin
  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  v_is_authorized := (v_token.patient_id = v_uid) or exists (
    select 1 from public.profiles pr
    where pr.id = v_uid and pr.org_id = v_token.org_id and pr.role in ('staff', 'admin')
  );
  if not v_is_authorized then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if v_token.status = 'waiting' then
    select count(*) into v_ahead
      from public.tokens t
      where t.service_id = v_token.service_id
        and t.service_day = v_token.service_day
        and t.status = 'waiting'
        and (t.lane_rank, t.priority_at, t.number) < (v_token.lane_rank, v_token.priority_at, v_token.number);

    select count(*) into v_open_counters
      from public.counters c
      join public.counter_services cs on cs.counter_id = c.id
      where cs.service_id = v_token.service_id and c.state = 'open';

    select bs.avg_service_secs into v_avg_secs
      from public.board_services bs
      where bs.service_id = v_token.service_id and bs.day = v_token.service_day;
  else
    v_ahead := null;
    v_open_counters := null;
    v_avg_secs := null;
  end if;

  return query
    select
      v_token.code,
      v_token.status,
      s.name,
      case when v_ahead is null then null else v_ahead + 1 end,
      v_ahead,
      case
        when v_ahead is null then null
        when v_open_counters is null or v_open_counters = 0 then null
        else (ceil((v_ahead + 1)::numeric / v_open_counters) * coalesce(v_avg_secs, s.default_service_secs))::int
      end,
      c.name,
      v_token.called_at,
      case when v_token.called_at is null then null
           else v_token.called_at + make_interval(mins => s.no_show_minutes) end,
      v_token.recall_count
    from public.services s
    left join public.counters c on c.id = v_token.counter_id
    where s.id = v_token.service_id;
end;
$$;

revoke execute on function public.my_queue_status(uuid) from public, anon;
grant execute on function public.my_queue_status(uuid) to authenticated;
