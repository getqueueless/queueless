-- Product rules (Yash), two independent pieces bundled in one migration since both land before
-- the same freeze.

-- ============================================================================================
-- 1. No double-booking the same time. A patient could otherwise hold/own two appointments (any
-- doctor, any service) that start at the exact same instant -- book_appointment and
-- start_paid_appointment only ever checked "one active booking per SERVICE", never across
-- services. appointments has no starts_at of its own (it lives on appointment_slots), so a
-- denormalized copy is added here, populated at insert time by both booking functions, backing
-- a partial unique index -- the real, race-proof guarantee. Concurrent requests can't both win:
-- the second insert hits the unique index and gets translated to a friendly 409, not a raw
-- constraint-violation leak.
alter table public.appointments add column starts_at timestamptz;
update public.appointments a set starts_at = s.starts_at from public.appointment_slots s where s.id = a.slot_id;
alter table public.appointments alter column starts_at set not null;

create unique index appointments_patient_no_time_clash
  on public.appointments (patient_id, starts_at)
  where status in ('pending_payment', 'booked');

-- The exact rule (Yash): don't let a patient book 2-3 appointments at the SAME time, but let
-- them book different timings freely -- including more than one in the same department, even
-- with the same doctor. That's in direct conflict with appointments_one_active (0056, Payment
-- work's own migration): a unique index on (patient_id, service_id) among active statuses, the
-- DB-level backstop for start_paid_appointment's old already_booked check below. Dropped here,
-- not just the application-level check -- leaving the index in place would have silently kept
-- blocking a second same-service booking regardless of what the function itself allowed
-- (confirmed the hard way: removing only the app check still failed with a raw unique-violation
-- until this drop landed too). appointments_patient_no_time_clash above is now the only
-- structural constraint on how many appointments a patient can hold.
drop index public.appointments_one_active;

create or replace function public.book_appointment(p_slot uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_slot public.appointment_slots;
  v_service public.services;
  v_existing public.appointments;
  v_count int;
  v_next_day timestamptz;
  v_retry_after int;
  v_appt public.appointments;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if private.my_role() = 'patient' then
    perform private.fail(402, 'payment_required', 'Booking this appointment requires payment -- use the paid booking flow');
  end if;

  perform private.require_complete_profile(v_patient);

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  select * into v_slot from public.appointment_slots where id = p_slot;
  if v_slot.id is null or v_slot.starts_at <= now() + interval '15 minutes' then
    perform private.fail(409, 'slot_closed', 'That slot can no longer be booked');
  end if;

  select * into v_service from public.services where id = v_slot.service_id;

  select * into v_existing from public.appointments
    where patient_id = v_patient and service_id = v_slot.service_id and status = 'booked'
    limit 1;
  if v_existing.id is not null then
    perform private.fail(409, 'already_booked', 'You already have a booking for this service',
      null, json_build_object('appointment_id', v_existing.id)::jsonb);
  end if;

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

  update public.appointment_slots
    set booked = booked + 1
    where id = p_slot and booked < capacity;
  if not found then
    perform private.fail(409, 'slot_full', 'That slot just filled up');
  end if;

  begin
    insert into public.appointments (slot_id, service_id, patient_id, status, doctor_id, starts_at)
    values (p_slot, v_slot.service_id, v_patient, 'booked', v_slot.doctor_id, v_slot.starts_at)
    returning * into v_appt;
  exception when unique_violation then
    perform private.fail(409, 'time_clash', 'You already have a booking at that time');
  end;

  return v_appt;
end;
$$;

-- ============================================================================================
-- 2. DB-level rate limits per patient. A cheap, generic hit log rather than one bespoke table
-- per action (claim_offline_token's private.claim_attempts stays exactly as it is -- it already
-- does its own 5/h with its own PGRST-can't-raise constraints, not worth the risk of touching
-- under this deadline). Staff/admin are exempt -- this is about a single patient hammering an
-- endpoint, not a staff member working a busy counter.
create table private.rate_hits (
  id bigint generated always as identity primary key,
  patient_id uuid not null,
  action text not null,
  hit_at timestamptz not null default now()
);
create index rate_hits_patient_action_idx on private.rate_hits (patient_id, action, hit_at);

alter table private.rate_hits enable row level security;
revoke all on private.rate_hits from public, anon, authenticated;

create function private.check_patient_rate_limit(p_patient uuid, p_action text, p_max int, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if exists (select 1 from public.profiles where id = p_patient and role in ('staff', 'admin')) then
    return;
  end if;

  select count(*) into v_count from private.rate_hits
    where patient_id = p_patient and action = p_action and hit_at > now() - p_window;
  if v_count >= p_max then
    perform private.fail(429, 'rate_limited', 'Too many requests, please slow down');
  end if;

  insert into private.rate_hits (patient_id, action) values (p_patient, p_action);
end;
$$;

revoke execute on function private.check_patient_rate_limit(uuid, text, int, interval) from public, anon, authenticated;

-- start_paid_appointment: both new pieces land here together -- the time_clash check/index and
-- its own 6/h rate limit.
create or replace function public.start_paid_appointment(p_slot uuid)
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
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'start_paid_appointment', 6, interval '1 hour');

  perform private.require_complete_profile(v_patient);

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
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

  update public.appointment_slots
    set booked = booked + 1
    where id = p_slot and booked < capacity;
  if not found then
    perform private.fail(409, 'slot_full', 'That slot just filled up');
  end if;

  begin
    insert into public.appointments (slot_id, service_id, patient_id, status, doctor_id, fee_inr, hold_expires_at, starts_at)
    values (p_slot, v_slot.service_id, v_patient, 'pending_payment', v_slot.doctor_id, v_doctor.fee_inr, now() + interval '10 minutes', v_slot.starts_at)
    returning * into v_appt;
  exception when unique_violation then
    perform private.fail(409, 'time_clash', 'You already have a booking at that time');
  end;

  return v_appt;
end;
$$;

create or replace function public.start_paid_booking(p_doctor_id uuid)
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
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'start_paid_booking', 6, interval '1 hour');

  perform private.require_complete_profile(v_patient);

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
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
    status, patient_id, doctor_id, fee_inr, hold_expires_at
  ) values (
    v_service.org_id, v_service.id, v_day, v_num, v_code, 'normal', 1, now(),
    'pending_payment', v_patient, p_doctor_id, v_doctor.fee_inr, now() + interval '10 minutes'
  )
  returning * into v_token;

  return v_token;
end;
$$;

create or replace function public.issue_token(p_service uuid)
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

  perform private.check_patient_rate_limit(v_patient, 'issue_token', 6, interval '1 hour');

  perform private.require_complete_profile(v_patient);

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

create or replace function public.cancel_token(p_token uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_token public.tokens;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'cancel_token', 10, interval '1 hour');

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  update public.tokens
    set status = 'cancelled'
    where id = p_token and patient_id = v_patient and status = 'waiting'
    returning * into v_token;

  if v_token.id is null then
    perform private.fail(409, 'illegal_transition', 'That ticket cannot be cancelled right now');
  end if;

  return v_token;
end;
$$;

create or replace function public.cancel_appointment(p_appointment uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_appt public.appointments;
  v_slot public.appointment_slots;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'cancel_appointment', 10, interval '1 hour');

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  select * into v_appt from public.appointments
    where id = p_appointment and patient_id = v_patient
    for no key update;

  if v_appt.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  select * into v_slot from public.appointment_slots where id = v_appt.slot_id;

  if v_appt.status <> 'booked' or v_slot.starts_at <= now() then
    perform private.fail(409, 'illegal_transition', 'That booking cannot be cancelled now');
  end if;

  update public.appointments set status = 'cancelled' where id = p_appointment
    returning * into v_appt;

  update public.appointment_slots set booked = booked - 1 where id = v_appt.slot_id;

  return v_appt;
end;
$$;
