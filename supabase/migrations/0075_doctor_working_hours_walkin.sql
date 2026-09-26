-- Doctor working-hours gate for walk-in tokens. Yash's gap: start_paid_booking (patient
-- self-service walk-in) let a patient take a doctor-bound ticket any time of day, even hours
-- before that doctor's shift starts or long after it ends -- doctor_schedules existed (0038) and
-- fed slot generation for appointments, but nothing checked it on the walk-in path. Window is
-- 60 minutes before shift start (so patients can queue up early) to 30 minutes before shift end
-- (so the last ticket taken can still realistically be seen); doctor_breaks are NOT checked here
-- (a mid-shift break doesn't close walk-ins, same as it doesn't block appointment slots outside
-- the break itself). Staff/kiosk issuance (staff_issue_token) is naturally exempt -- it doesn't
-- take a doctor_id at all, so there's no doctor window to enforce there.
create or replace function public.start_paid_booking(
  p_doctor_id uuid, p_requested_lane public.lane default 'normal', p_note text default null
)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_doctor public.doctors;
  v_service public.services;
  v_existing public.tokens;
  v_count int;
  v_oldest timestamptz;
  v_retry_after int;
  v_next_day timestamptz;
  v_day date;
  v_num int;
  v_code text;
  v_token public.tokens;
  v_lane public.lane;
  v_requested public.lane;
  v_priority_at timestamptz;
  v_head_start int;
  v_pending_count int;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'start_paid_booking', 6, interval '1 hour');

  perform private.require_complete_profile(v_patient);

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  if p_requested_lane not in ('normal', 'pregnant', 'emergency') then
    perform private.fail(400, 'lane_not_allowed', 'You cannot request that priority lane');
  end if;
  if p_note is not null and char_length(p_note) > 80 then
    perform private.fail(400, 'note_too_long', 'Note must be 80 characters or fewer');
  end if;

  select * into v_doctor from public.doctors where id = p_doctor_id;
  if v_doctor.id is null or not v_doctor.active then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if v_doctor.fee_inr <= 0 then
    perform private.fail(409, 'not_payable', 'This doctor has no online fee configured');
  end if;

  select * into v_service from public.services where id = v_doctor.service_id;
  if v_service.id is null or not v_service.is_open then
    perform private.fail(409, 'service_closed', 'This service is not open right now');
  end if;

  if exists (
    select 1 from public.doctor_leaves dl
    where dl.doctor_id = p_doctor_id
      and private.service_day(v_service.org_id, now()) between dl.from_date and dl.to_date
  ) then
    perform private.fail(409, 'doctor_on_leave', 'This doctor is on leave today');
  end if;

  if not exists (
    select 1
    from public.doctor_schedules ds
    join public.organizations o on o.id = v_service.org_id
    where ds.doctor_id = p_doctor_id
      and ds.weekday = extract(dow from private.service_day(v_service.org_id, now()))::smallint
      and now() >= ((private.service_day(v_service.org_id, now())::text || ' ' || ds.start_time::text)::timestamp at time zone o.timezone) - interval '60 minutes'
      and now() <= ((private.service_day(v_service.org_id, now())::text || ' ' || ds.end_time::text)::timestamp at time zone o.timezone) - interval '30 minutes'
  ) then
    perform private.fail(409, 'outside_hours', 'This doctor is not accepting walk-ins right now');
  end if;

  select * into v_existing from public.tokens
    where patient_id = v_patient and service_id = v_service.id
      and status in ('pending_payment', 'waiting', 'called', 'serving')
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

  -- resolve the priority request: senior is auto-detected and wins regardless of what was
  -- asked for; pregnant/emergency stay pending (lane stays normal) until staff verifies; a plain
  -- 'normal' request is simply no request at all.
  if private.patient_is_senior(v_patient) then
    v_lane := 'senior';
    v_requested := 'senior';
  elsif p_requested_lane in ('pregnant', 'emergency') then
    v_lane := 'normal';
    v_requested := p_requested_lane;

    -- anti-abuse: max 1 pending (unverified) priority request per patient per day, across both
    -- tokens and appointments -- otherwise nothing stops someone claiming pregnant on every
    -- ticket they take.
    select count(*) into v_pending_count
      from public.tokens
      where patient_id = v_patient and requested_lane in ('pregnant', 'emergency') and lane = 'normal'
        and service_day = private.service_day(v_service.org_id, now());
    select v_pending_count + count(*) into v_pending_count
      from public.appointments a join public.services s on s.id = a.service_id
      where a.patient_id = v_patient and a.requested_lane in ('pregnant', 'emergency')
        and private.service_day(s.org_id, a.created_at) = private.service_day(v_service.org_id, now());
    if v_pending_count >= 1 then
      perform private.fail(409, 'priority_request_pending', 'You already have a priority request pending today');
    end if;
  else
    v_lane := 'normal';
    v_requested := null;
  end if;

  v_priority_at := now();
  if v_lane = 'senior' then
    select o.priority_head_start_minutes into v_head_start from public.organizations o where o.id = v_service.org_id;
    v_priority_at := now() - make_interval(mins => v_head_start);
  end if;

  v_day := private.service_day(v_service.org_id, now());
  insert into private.service_days (service_id, day, last_number)
  values (v_service.id, v_day, 1)
  on conflict (service_id, day) do update set last_number = private.service_days.last_number + 1
  returning last_number into v_num;

  if v_num > v_service.max_tokens_per_day then
    perform private.fail(409, 'queue_full', 'This queue is full for today');
  end if;

  v_code := v_service.code || '-' || lpad(v_num::text, greatest(3, length(v_num::text)), '0');

  insert into public.tokens (
    org_id, service_id, service_day, number, code, lane, lane_rank, priority_at,
    status, patient_id, doctor_id, fee_inr, hold_expires_at, requested_lane, requested_lane_note
  ) values (
    v_service.org_id, v_service.id, v_day, v_num, v_code, v_lane, 1, v_priority_at,
    'pending_payment', v_patient, p_doctor_id, v_doctor.fee_inr, now() + interval '10 minutes',
    v_requested, case when v_requested is not null then p_note else null end
  )
  returning * into v_token;

  return v_token;
end;
$$;

revoke execute on function public.start_paid_booking(uuid, public.lane, text) from public, anon;
grant execute on function public.start_paid_booking(uuid, public.lane, text) to authenticated;

-- UI helper: when is the next window this doctor will actually accept a walk-in? Same 60-before
-- to 30-before-end math as the gate above, walked forward day by day (skipping leave days) up to
-- two weeks out. Public read, like doctor_schedules itself -- a patient needs this BEFORE signing
-- in to decide whether it's worth coming in.
create function public.next_walkin_window(p_doctor_id uuid)
returns table (window_starts_at timestamptz, window_ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doctor public.doctors;
  v_org public.organizations;
  v_day date;
  v_days_checked int := 0;
  v_sched record;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_doctor from public.doctors where id = p_doctor_id;
  if v_doctor.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  select * into v_org from public.organizations where id = v_doctor.org_id;

  v_day := private.service_day(v_doctor.org_id, now());
  while v_days_checked < 14 loop
    if not exists (
      select 1 from public.doctor_leaves dl
      where dl.doctor_id = p_doctor_id and v_day between dl.from_date and dl.to_date
    ) then
      for v_sched in
        select * from public.doctor_schedules
        where doctor_id = p_doctor_id and weekday = extract(dow from v_day)::smallint
        order by start_time
      loop
        v_start := ((v_day::text || ' ' || v_sched.start_time::text)::timestamp at time zone v_org.timezone) - interval '60 minutes';
        v_end := ((v_day::text || ' ' || v_sched.end_time::text)::timestamp at time zone v_org.timezone) - interval '30 minutes';
        if v_end > now() then
          window_starts_at := v_start;
          window_ends_at := v_end;
          return next;
          return;
        end if;
      end loop;
    end if;
    v_day := v_day + 1;
    v_days_checked := v_days_checked + 1;
  end loop;

  return;
end;
$$;

revoke execute on function public.next_walkin_window(uuid) from public;
grant execute on function public.next_walkin_window(uuid) to anon, authenticated;
