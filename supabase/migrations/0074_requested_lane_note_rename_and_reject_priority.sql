-- Renaming to match what's already live: counter-console.tsx (already shipped, ahead of this
-- migration) reads `requested_lane_note`, not the `requested_note` 0072 actually created --
-- confirmed by reading the live component source, not guessed. Renaming the column is less
-- disruptive than asking an already-shipped screen to change, and nothing else references the
-- old name yet (0072 only pushed a short while ago). The 4 functions that write it are
-- redefined with the corrected column name; their signatures are unchanged from 0072, so this is
-- a genuine CREATE OR REPLACE, not a drop+recreate -- existing grants carry over untouched.
alter table public.tokens rename column requested_note to requested_lane_note;
alter table public.appointments rename column requested_note to requested_lane_note;

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

create or replace function public.start_paid_appointment(
  p_slot uuid, p_requested_lane public.lane default 'normal', p_note text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_slot public.appointment_slots;
  v_service public.services;
  v_doctor public.doctors;
  v_count int;
  v_next_day timestamptz;
  v_retry_after int;
  v_appt public.appointments;
  v_requested public.lane;
  v_pending_count int;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'start_paid_appointment', 6, interval '1 hour');

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

  select * into v_slot from public.appointment_slots where id = p_slot;
  if v_slot.id is null or v_slot.starts_at <= now() + interval '15 minutes' then
    perform private.fail(409, 'slot_closed', 'That slot can no longer be booked');
  end if;
  if v_slot.doctor_id is null then
    perform private.fail(409, 'no_doctor_for_slot', 'This slot has no doctor assigned to bill against');
  end if;

  select * into v_doctor from public.doctors where id = v_slot.doctor_id;
  if v_doctor.id is null or not v_doctor.active then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if v_doctor.fee_inr <= 0 then
    perform private.fail(409, 'not_payable', 'This doctor has no online fee configured');
  end if;

  select * into v_service from public.services where id = v_slot.service_id;

  if exists (
    select 1 from public.doctor_leaves dl
    where dl.doctor_id = v_slot.doctor_id
      and private.service_day(v_service.org_id, v_slot.starts_at) between dl.from_date and dl.to_date
  ) then
    perform private.fail(409, 'doctor_on_leave', 'This doctor is on leave that day');
  end if;

  -- No same-service/same-doctor restriction here (Yash's rule): a patient can hold several
  -- appointments in the same department, even with the same doctor, as long as they're at
  -- different times. The only thing blocked at this granularity is the exact same start time --
  -- time_clash below, backed by the real unique-index guarantee -- plus the 2-unpaid-hold cap
  -- and the rate limit further down.
  if exists (
    select 1 from public.appointments
    where patient_id = v_patient and starts_at = v_slot.starts_at and status in ('pending_payment', 'booked')
  ) then
    perform private.fail(409, 'time_clash',
      'You already have a booking at ' ||
      to_char(v_slot.starts_at at time zone (select timezone from public.organizations where id = v_service.org_id), 'HH24:MI'));
  end if;

  select count(*) into v_count
    from public.tokens
    where patient_id = v_patient
      and org_id = v_service.org_id
      and service_day = private.service_day(v_service.org_id, now())
      and status in ('cancelled', 'no_show');
  if v_count >= 3 then
    select ((private.service_day(v_service.org_id, now()) + 1)::timestamp at time zone o.timezone)
      into v_next_day from public.organizations o where o.id = v_service.org_id;
    v_retry_after := greatest(1, ceil(extract(epoch from (v_next_day - now())))::int);
    perform private.fail(403, 'cooldown', 'Too many cancellations today, try again tomorrow', v_retry_after);
  end if;

  select count(*) into v_count
    from public.appointments a
    join public.services s2 on s2.id = a.service_id
    where a.patient_id = v_patient
      and s2.org_id = v_service.org_id
      and private.service_day(v_service.org_id, a.created_at) = private.service_day(v_service.org_id, now());
  if v_count >= 3 then
    perform private.fail(409, 'queue_full', 'You have reached today''s booking limit');
  end if;

  select count(*) into v_count
    from public.appointments
    where patient_id = v_patient and status = 'pending_payment';
  if v_count >= 2 then
    perform private.fail(409, 'too_many_holds', 'You already have 2 unpaid holds -- pay or let one expire before starting another');
  end if;

  if private.patient_is_senior(v_patient) then
    v_requested := 'senior';
  elsif p_requested_lane in ('pregnant', 'emergency') then
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
    v_requested := p_requested_lane;
  else
    v_requested := null;
  end if;

  update public.appointment_slots
    set booked = booked + 1
    where id = p_slot and booked < capacity;
  if not found then
    perform private.fail(409, 'slot_full', 'That slot just filled up');
  end if;

  begin
    insert into public.appointments (
      slot_id, service_id, patient_id, status, doctor_id, fee_inr, hold_expires_at, starts_at,
      requested_lane, requested_lane_note
    )
    values (
      p_slot, v_slot.service_id, v_patient, 'pending_payment', v_slot.doctor_id, v_doctor.fee_inr,
      now() + interval '10 minutes', v_slot.starts_at,
      v_requested, case when v_requested is not null then p_note else null end
    )
    returning * into v_appt;
  exception when unique_violation then
    perform private.fail(409, 'time_clash', 'You already have a booking at that time');
  end;

  return v_appt;
end;
$$;

create or replace function public.check_in(p_appointment uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_appt public.appointments;
  v_slot public.appointment_slots;
  v_service public.services;
  v_token public.tokens;
  v_head_start int;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  select * into v_appt from public.appointments
    where id = p_appointment and patient_id = v_patient
    for no key update;

  if v_appt.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if v_appt.status <> 'booked' then
    perform private.fail(409, 'illegal_transition', 'That booking cannot be checked in now');
  end if;

  select * into v_slot from public.appointment_slots where id = v_appt.slot_id;
  select * into v_service from public.services where id = v_appt.service_id;

  if now() < v_slot.starts_at - interval '30 minutes' or now() > v_slot.starts_at + interval '15 minutes' then
    perform private.fail(409, 'checkin_window', 'It is too early or too late to check in');
  end if;

  v_token := private.mint_token(
    v_service.org_id, v_appt.service_id, 'appointment', v_patient, null,
    p_appointment, greatest(v_slot.starts_at, now()), null, v_appt.doctor_id
  );

  if v_appt.requested_lane is not null then
    if v_appt.requested_lane = 'senior' then
      select o.priority_head_start_minutes into v_head_start from public.organizations o where o.id = v_service.org_id;
      update public.tokens
        set requested_lane = v_appt.requested_lane, requested_lane_note = v_appt.requested_lane_note,
          lane = 'senior', priority_at = v_token.priority_at - make_interval(mins => v_head_start)
        where id = v_token.id
        returning * into v_token;
    else
      update public.tokens
        set requested_lane = v_appt.requested_lane, requested_lane_note = v_appt.requested_lane_note
        where id = v_token.id
        returning * into v_token;
    end if;
  end if;

  update public.appointments set status = 'checked_in', token_id = v_token.id where id = p_appointment;

  return v_token;
end;
$$;

create or replace function public.verify_priority(p_token uuid, p_status public.lane)
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

  if p_status not in ('senior', 'pregnant', 'emergency', 'normal') then
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

  if p_status = 'normal' then
    if v_token.patient_id is not null then
      update public.profiles set priority_status = null, priority_verified_by = v_staff, priority_verified_at = now()
        where id = v_token.patient_id;
    end if;
    update public.tokens set requested_lane = null, requested_lane_note = null
      where id = p_token
      returning * into v_token;
    return v_token;
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

-- reject_priority(p_token): counter-console.tsx's "Reject" button did a raw
-- `.from("tokens").update({requested_lane: null})` -- authenticated has no direct write on
-- tokens (0047), so that call has been failing since this feature shipped. This is the real,
-- narrow door: same effect as verify_priority(p_token, 'normal'), under its own name so the
-- frontend's intent ("reject this request") doesn't have to be spelled as a lane value.
create function public.reject_priority(p_token uuid)
returns public.tokens
language sql
security definer
set search_path = ''
as $$
  select * from public.verify_priority(p_token, 'normal'::public.lane);
$$;

revoke execute on function public.reject_priority(uuid) from public, anon;
grant execute on function public.reject_priority(uuid) to authenticated;

