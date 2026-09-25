create function private.mint_token(
  p_org uuid,
  p_service uuid,
  p_lane public.lane,
  p_patient uuid,
  p_walk_in_label text,
  p_appointment uuid,
  p_arrival timestamptz,
  p_issued_by uuid
)
returns public.tokens
language plpgsql
set search_path = ''
as $$
declare
  v_day date;
  v_num int;
  v_service public.services;
  v_lane_rank smallint;
  v_code text;
  v_token public.tokens;
begin
  v_day := private.service_day(p_org, now());

  select * into v_service from public.services where id = p_service;

  insert into private.service_days (service_id, day, last_number)
  values (p_service, v_day, 1)
  on conflict (service_id, day) do update set last_number = private.service_days.last_number + 1
  returning last_number into v_num;

  if v_num > v_service.max_tokens_per_day and p_lane <> 'emergency' then
    perform private.fail(409, 'queue_full', 'This queue is full for today');
  end if;

  v_lane_rank := case when p_lane = 'emergency' then 0 else 1 end;
  v_code := v_service.code || '-' || lpad(v_num::text, greatest(3, length(v_num::text)), '0');

  insert into public.tokens (
    org_id, service_id, service_day, number, code, lane, lane_rank, priority_at,
    status, patient_id, walk_in_label, issued_by, appointment_id
  ) values (
    p_org, p_service, v_day, v_num, v_code, p_lane, v_lane_rank, p_arrival,
    'waiting', p_patient, p_walk_in_label, p_issued_by, p_appointment
  )
  returning * into v_token;

  return v_token;
end;
$$;

revoke execute on function private.mint_token(uuid, uuid, public.lane, uuid, text, uuid, timestamptz, uuid)
  from public, anon, authenticated;
