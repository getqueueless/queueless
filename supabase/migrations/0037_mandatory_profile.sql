create type public.gender as enum ('female', 'male', 'other', 'prefer_not');

alter table public.profiles
  add column date_of_birth date,
  add column gender public.gender,
  add column address_line text,
  add column city text,
  add column profile_completed_at timestamptz,
  add constraint profiles_date_of_birth_sane
    check (date_of_birth is null or (date_of_birth < current_date and date_of_birth > current_date - interval '120 years')),
  add constraint profiles_phone_e164_in
    check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$');

-- One person, one account: a phone can only sit on one patient profile. Patients don't carry
-- org_id (only staff/admin do -- see private.handle_new_user/set_member_role), so this is a
-- global uniqueness among patients rather than literally per-org; in this single-tenant system
-- that's the same thing, and there is no other per-patient org column to scope it to without a
-- much bigger schema change than this task asked for.
create unique index profiles_patient_phone_unique on public.profiles (phone)
  where role = 'patient' and phone is not null;

-- Shared by every public RPC that requires a complete profile (issue_token, book_appointment
-- below via CREATE OR REPLACE; claim_offline_token when it's defined in a later migration).
create function private.require_complete_profile(p_uid uuid)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where id = p_uid and profile_completed_at is not null
  ) then
    perform private.fail(403, 'profile_incomplete', 'Please complete your profile first');
  end if;
end;
$$;

revoke execute on function private.require_complete_profile(uuid) from public, anon, authenticated;

create function public.complete_my_profile(
  p_full_name text, p_phone text, p_date_of_birth date, p_gender public.gender,
  p_city text, p_address_line text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_full_name text;
  v_city text;
  v_profile public.profiles;
begin
  if v_uid is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  v_full_name := nullif(trim(p_full_name), '');
  v_city := nullif(trim(p_city), '');
  if v_full_name is null or v_city is null then
    perform private.fail(400, 'invalid_profile', 'Name and city are required');
  end if;

  if p_phone !~ '^\+91[6-9][0-9]{9}$' then
    perform private.fail(400, 'invalid_phone', 'Enter a 10-digit Indian mobile number');
  end if;

  if p_date_of_birth is null or not (p_date_of_birth < current_date and p_date_of_birth > current_date - interval '120 years') then
    perform private.fail(400, 'invalid_date_of_birth', 'Enter a valid date of birth');
  end if;

  if exists (
    select 1 from public.profiles
    where role = 'patient' and phone = p_phone and id <> v_uid
  ) then
    perform private.fail(409, 'phone_in_use', 'That phone number is already registered');
  end if;

  update public.profiles set
    full_name = v_full_name,
    phone = p_phone,
    date_of_birth = p_date_of_birth,
    gender = p_gender,
    city = v_city,
    address_line = nullif(trim(coalesce(p_address_line, '')), ''),
    profile_completed_at = coalesce(profile_completed_at, now())
  where id = v_uid
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke execute on function public.complete_my_profile(text, text, date, public.gender, text, text) from public, anon;
grant execute on function public.complete_my_profile(text, text, date, public.gender, text, text) to authenticated;

-- issue_token and book_appointment redefined (CREATE OR REPLACE, not editing 0010/0013's files)
-- with one added guard each, right after the sign-in check. Bodies otherwise unchanged from
-- what's live today -- verified against pg_get_functiondef before writing this file.
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

revoke execute on function public.issue_token(uuid) from public, anon;
grant execute on function public.issue_token(uuid) to authenticated;

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

  insert into public.appointments (slot_id, service_id, patient_id, status)
  values (p_slot, v_slot.service_id, v_patient, 'booked')
  returning * into v_appt;

  return v_appt;
end;
$$;

revoke execute on function public.book_appointment(uuid) from public, anon;
grant execute on function public.book_appointment(uuid) to authenticated;
