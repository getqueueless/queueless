create function public.issue_token(p_service uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_service public.services;
  v_existing public.tokens;
  v_count int;
  v_oldest timestamptz;
  v_retry_after int;
  v_next_day timestamptz;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  select * into v_service from public.services where id = p_service;
  if v_service.id is null or not v_service.is_open then
    perform private.fail(409, 'service_closed', 'This service is not open right now');
  end if;

  select * into v_existing from public.tokens
    where patient_id = v_patient and service_id = p_service
      and status in ('waiting', 'called', 'serving')
    limit 1;
  if v_existing.id is not null then
    perform private.fail(409, 'already_active', 'You already have a ticket for this service',
      null, json_build_object('token_id', v_existing.id, 'code', v_existing.code)::jsonb);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.tokens
    where patient_id = v_patient and created_at > now() - interval '10 minutes';
  if v_count >= 3 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::int);
    perform private.fail(429, 'rate_limited', 'Too many requests, please slow down', v_retry_after);
  end if;

  select count(*) into v_count
    from public.tokens
    where patient_id = v_patient
      and org_id = v_service.org_id
      and service_day = private.service_day(v_service.org_id, now())
      and status in ('cancelled', 'no_show');
  if v_count >= 3 then
    select ((private.service_day(v_service.org_id, now()) + 1)::timestamp at time zone o.timezone)
      into v_next_day
      from public.organizations o where o.id = v_service.org_id;
    v_retry_after := greatest(1, ceil(extract(epoch from (v_next_day - now())))::int);
    perform private.fail(403, 'cooldown', 'Too many cancellations today, try again tomorrow', v_retry_after);
  end if;

  return private.mint_token(v_service.org_id, p_service, 'normal', v_patient, null, null, now(), null);
end;
$$;

revoke execute on function public.issue_token(uuid) from public, anon;
grant execute on function public.issue_token(uuid) to authenticated;
