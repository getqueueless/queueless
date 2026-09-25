-- P0 (QA): complete_my_profile and staff_register_walkin both required the caller to already
-- send a phone number pre-formatted as +91XXXXXXXXXX -- typing a plain 10-digit number (what
-- basically every real user types) was rejected outright. private.normalize_in_phone accepts the
-- three forms a person actually types (bare 10 digits, 91-prefixed, +91-prefixed, with spaces/
-- dashes anywhere), and always stores the single canonical +91XXXXXXXXXX form, so
-- claim_offline_token's phone match (profiles.phone = walkin_patients.phone, written by these two
-- functions respectively) keeps working without needing its own copy of this logic -- it never
-- took a phone parameter, it only reads what's already stored.
create function private.normalize_in_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  if v_digits ~ '^[6-9][0-9]{9}$' then
    return '+91' || v_digits;
  elsif v_digits ~ '^91[6-9][0-9]{9}$' then
    return '+' || v_digits;
  elsif v_digits ~ '^\+91[6-9][0-9]{9}$' then
    return v_digits;
  end if;
  return null;
end;
$$;

revoke execute on function private.normalize_in_phone(text) from public, anon, authenticated;

create or replace function public.complete_my_profile(
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
  v_phone text;
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

  v_phone := private.normalize_in_phone(p_phone);
  if v_phone is null then
    perform private.fail(400, 'invalid_phone', 'Enter a 10-digit Indian mobile number');
  end if;

  if p_date_of_birth is null or not (p_date_of_birth < current_date and p_date_of_birth > current_date - interval '120 years') then
    perform private.fail(400, 'invalid_date_of_birth', 'Enter a valid date of birth');
  end if;

  if exists (
    select 1 from public.profiles
    where role = 'patient' and phone = v_phone and id <> v_uid
  ) then
    perform private.fail(409, 'phone_in_use', 'That phone number is already registered');
  end if;

  update public.profiles set
    full_name = v_full_name,
    phone = v_phone,
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

create or replace function public.staff_register_walkin(
  p_full_name text, p_phone text, p_date_of_birth date, p_gender public.gender, p_city text,
  p_service_id uuid, p_doctor_id uuid default null, p_lane public.lane default 'normal',
  p_cash_received boolean default false, p_amount_override int default null
)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_service public.services;
  v_walkin public.walkin_patients;
  v_token public.tokens;
  v_day date;
  v_receipt_no_num int;
  v_amount int;
  v_phone text;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_service from public.services where id = p_service_id;
  if v_service.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = v_service.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  v_phone := private.normalize_in_phone(p_phone);
  if v_phone is null then
    perform private.fail(400, 'invalid_phone', 'Enter a 10-digit Indian mobile number');
  end if;
  if nullif(trim(p_full_name), '') is null then
    perform private.fail(400, 'invalid_profile', 'Name is required');
  end if;
  if not v_service.is_open and p_lane <> 'emergency' then
    perform private.fail(409, 'service_closed', 'This service is not open right now');
  end if;

  insert into public.walkin_patients (org_id, phone, full_name, date_of_birth, gender, city)
  values (v_service.org_id, v_phone, trim(p_full_name), p_date_of_birth, p_gender, nullif(trim(coalesce(p_city, '')), ''))
  on conflict (org_id, phone) do update set
    full_name = excluded.full_name, date_of_birth = excluded.date_of_birth,
    gender = excluded.gender, city = excluded.city
  returning * into v_walkin;

  if exists (
    select 1 from public.tokens
    where walkin_patient_id = v_walkin.id and service_id = p_service_id and status in ('waiting', 'called', 'serving')
  ) then
    perform private.fail(409, 'already_active', 'That patient already has a ticket for this service');
  end if;

  v_token := private.mint_token(
    v_service.org_id, p_service_id, p_lane, null, trim(p_full_name), null, now(), v_staff, p_doctor_id
  );
  update public.tokens set walkin_patient_id = v_walkin.id where id = v_token.id
    returning * into v_token;

  if p_cash_received then
    v_day := private.service_day(v_service.org_id, now());
    v_amount := coalesce(p_amount_override, (select fee_inr from public.doctors where id = p_doctor_id), 0);
    if v_amount < 0 then
      perform private.fail(400, 'invalid_amount', 'Amount cannot be negative');
    end if;

    insert into private.cash_receipt_days (org_id, day, last_number)
    values (v_service.org_id, v_day, 1)
    on conflict (org_id, day) do update set last_number = private.cash_receipt_days.last_number + 1
    returning last_number into v_receipt_no_num;

    insert into public.cash_receipts (org_id, token_id, patient_phone, doctor_id, amount_inr, receipt_no, collected_by)
    values (
      v_service.org_id, v_token.id, v_phone, p_doctor_id, v_amount,
      'R-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_receipt_no_num::text, 4, '0'),
      v_staff
    );
  end if;

  return v_token;
end;
$$;
