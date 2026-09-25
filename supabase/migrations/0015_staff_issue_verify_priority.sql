create function public.staff_issue_token(
  p_service uuid, p_lane public.lane, p_walk_in_label text, p_patient uuid default null
)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_service public.services;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_service from public.services where id = p_service;

  if not exists (
    select 1 from public.profiles
    where id = v_staff and org_id = v_service.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  if p_patient is not null then
    if not pg_try_advisory_xact_lock(hashtextextended('patient:' || p_patient, 0)) then
      perform private.fail(429, 'busy', 'Still working on your last request', 1);
    end if;
  end if;

  if v_service.id is null or (not v_service.is_open and p_lane <> 'emergency') then
    perform private.fail(409, 'service_closed', 'This service is not open right now');
  end if;

  if p_patient is not null and exists (
    select 1 from public.tokens
    where patient_id = p_patient and service_id = p_service and status in ('waiting', 'called', 'serving')
  ) then
    perform private.fail(409, 'already_active', 'That patient already has a ticket for this service');
  end if;

  return private.mint_token(v_service.org_id, p_service, p_lane, p_patient, p_walk_in_label, null, now(), v_staff);
end;
$$;

revoke execute on function public.staff_issue_token(uuid, public.lane, text, uuid) from public, anon;
grant execute on function public.staff_issue_token(uuid, public.lane, text, uuid) to authenticated;

create function public.verify_priority(p_token uuid, p_status public.lane)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_token public.tokens;
  v_head_start int;
  v_new_priority_at timestamptz;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if p_status not in ('senior', 'pregnant') then
    perform private.fail(403, 'lane_not_allowed', 'That is not a verifiable priority status');
  end if;

  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_staff and org_id = v_token.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  if v_token.patient_id is not null then
    update public.profiles
      set priority_status = p_status, priority_verified_by = v_staff, priority_verified_at = now()
      where id = v_token.patient_id;
  end if;

  if v_token.status = 'waiting' then
    select o.priority_head_start_minutes into v_head_start
      from public.organizations o where o.id = v_token.org_id;
    v_new_priority_at := least(v_token.priority_at, v_token.created_at - make_interval(mins => v_head_start));
    update public.tokens set lane = p_status, priority_at = v_new_priority_at
      where id = p_token
      returning * into v_token;
  end if;

  return v_token;
end;
$$;

revoke execute on function public.verify_priority(uuid, public.lane) from public, anon;
grant execute on function public.verify_priority(uuid, public.lane) to authenticated;
