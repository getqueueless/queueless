-- A walk-in registered at the desk doesn't need (and per spec, must not require) an auth
-- account. Keyed by (org, phone), separate from public.profiles entirely -- profiles.id has a
-- hard FK to auth.users, so a phone-only walk-in record can never live there. This also gives
-- claim_offline_token (a later migration) something real to match against: the same phone
-- number returning across visits is the same walkin_patients row.
create table public.walkin_patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  phone text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  full_name text not null,
  date_of_birth date,
  gender public.gender,
  city text,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);

alter table public.tokens add column walkin_patient_id uuid references public.walkin_patients (id) on delete set null;
-- Same backstop as tokens_one_active (patient_id), mirrored for walk-in identity: one active
-- ticket per walk-in phone per service, enforced by the database, not just the RPC's own check.
create unique index tokens_one_active_walkin on public.tokens (walkin_patient_id, service_id)
  where status in ('waiting', 'called', 'serving') and walkin_patient_id is not null;

alter table public.walkin_patients enable row level security;
revoke all on public.walkin_patients from public, anon, authenticated;
-- No direct read grant at all, even to authenticated: this table exists only for
-- staff_register_walkin/claim_offline_token (both SECURITY DEFINER) to use internally. A
-- walk-in's phone number is exactly the kind of thing that must never leak through a raw
-- PostgREST select.

-- Same atomic-counter pattern as private.service_days: the row lock is what makes numbering
-- gapless and duplicate-free under concurrency, same reasoning as private.mint_token.
create table private.cash_receipt_days (
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  last_number int not null default 0,
  primary key (org_id, day)
);

-- Append-only ledger: no update/delete grant to anyone, ever (enforced below same as
-- audit_log). A correction is a new row with a negative amount, linked via refund_of, entered
-- by an admin only -- never a mutation of the original.
create table public.cash_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_id uuid references public.tokens (id) on delete set null,
  patient_phone text not null,
  doctor_id uuid references public.doctors (id) on delete set null,
  amount_inr int not null,
  receipt_no text not null,
  collected_by uuid not null references public.profiles (id),
  refund_of uuid references public.cash_receipts (id),
  reason text,
  created_at timestamptz not null default now(),
  unique (org_id, receipt_no),
  constraint cash_receipts_refund_shape check (
    (refund_of is null and amount_inr >= 0) or (refund_of is not null and amount_inr < 0 and reason is not null)
  )
);

create index cash_receipts_org_day_idx on public.cash_receipts (org_id, created_at);
create index cash_receipts_collected_by_idx on public.cash_receipts (collected_by, created_at);
create index cash_receipts_doctor_idx on public.cash_receipts (doctor_id, created_at);

create function private.forbid_cash_receipts_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'cash_receipts is append-only';
end;
$$;

create trigger cash_receipts_no_update
  before update on public.cash_receipts
  for each row execute function private.forbid_cash_receipts_mutation();
create trigger cash_receipts_no_delete
  before delete on public.cash_receipts
  for each row execute function private.forbid_cash_receipts_mutation();
create trigger cash_receipts_no_truncate
  before truncate on public.cash_receipts
  for each statement execute function private.forbid_cash_receipts_mutation();

revoke execute on function private.forbid_cash_receipts_mutation() from public, anon, authenticated;

alter table public.cash_receipts enable row level security;
revoke all on public.cash_receipts from public, anon, authenticated;
-- No direct grants: every read goes through my_cash_today/cash_report_by_staff/
-- cash_report_by_doctor below (all SECURITY DEFINER, org- and identity-scoped there), every
-- write through staff_register_walkin/admin_refund_cash_receipt. A raw select here would leak
-- patient_phone across the whole org to anyone who found a way to read the table directly.

create function public.staff_register_walkin(
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

  if p_phone !~ '^\+91[6-9][0-9]{9}$' then
    perform private.fail(400, 'invalid_phone', 'Enter a 10-digit Indian mobile number');
  end if;
  if nullif(trim(p_full_name), '') is null then
    perform private.fail(400, 'invalid_profile', 'Name is required');
  end if;
  if not v_service.is_open and p_lane <> 'emergency' then
    perform private.fail(409, 'service_closed', 'This service is not open right now');
  end if;

  insert into public.walkin_patients (org_id, phone, full_name, date_of_birth, gender, city)
  values (v_service.org_id, p_phone, trim(p_full_name), p_date_of_birth, p_gender, nullif(trim(coalesce(p_city, '')), ''))
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
      v_service.org_id, v_token.id, p_phone, p_doctor_id, v_amount,
      'R-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_receipt_no_num::text, 4, '0'),
      v_staff
    );
  end if;

  return v_token;
end;
$$;

revoke execute on function public.staff_register_walkin(text, text, date, public.gender, text, uuid, uuid, public.lane, boolean, int)
  from public, anon;
grant execute on function public.staff_register_walkin(text, text, date, public.gender, text, uuid, uuid, public.lane, boolean, int)
  to authenticated;

create function public.admin_refund_cash_receipt(p_receipt_id uuid, p_reason text)
returns public.cash_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_original public.cash_receipts;
  v_day date;
  v_receipt_no_num int;
  v_refund public.cash_receipts;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_original from public.cash_receipts where id = p_receipt_id;
  if v_original.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if not exists (
    select 1 from public.profiles where id = v_admin and org_id = v_original.org_id and role = 'admin'
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;
  if v_original.refund_of is not null then
    perform private.fail(409, 'illegal_transition', 'That receipt is itself a refund and cannot be refunded again');
  end if;
  if nullif(trim(p_reason), '') is null then
    perform private.fail(400, 'invalid_profile', 'A reason is required for a refund');
  end if;

  v_day := private.service_day(v_original.org_id, now());
  insert into private.cash_receipt_days (org_id, day, last_number)
  values (v_original.org_id, v_day, 1)
  on conflict (org_id, day) do update set last_number = private.cash_receipt_days.last_number + 1
  returning last_number into v_receipt_no_num;

  insert into public.cash_receipts (
    org_id, token_id, patient_phone, doctor_id, amount_inr, receipt_no, collected_by, refund_of, reason
  ) values (
    v_original.org_id, v_original.token_id, v_original.patient_phone, v_original.doctor_id,
    -v_original.amount_inr, 'R-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_receipt_no_num::text, 4, '0'),
    v_admin, v_original.id, p_reason
  )
  returning * into v_refund;

  return v_refund;
end;
$$;

revoke execute on function public.admin_refund_cash_receipt(uuid, text) from public, anon;
grant execute on function public.admin_refund_cash_receipt(uuid, text) to authenticated;

-- The calling staff member's own receipts today -- never another staff member's, even for an
-- admin (use cash_report_by_staff for that).
create function public.my_cash_today()
returns table (
  id uuid, token_id uuid, doctor_id uuid, amount_inr int, receipt_no text,
  refund_of uuid, reason text, created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  return query
    select cr.id, cr.token_id, cr.doctor_id, cr.amount_inr, cr.receipt_no, cr.refund_of, cr.reason, cr.created_at
    from public.cash_receipts cr
    join public.profiles p on p.id = v_staff
    join public.organizations o on o.id = p.org_id
    where cr.collected_by = v_staff
      and cr.org_id = p.org_id
      and (cr.created_at at time zone o.timezone)::date = private.service_day(p.org_id, now())
    order by cr.created_at desc;
end;
$$;

revoke execute on function public.my_cash_today() from public, anon;
grant execute on function public.my_cash_today() to authenticated;

create function public.cash_report_by_staff(p_from date, p_to date)
returns table (collected_by uuid, staff_name text, receipt_count bigint, total_inr bigint)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_org uuid;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  select org_id into v_org from public.profiles where id = v_admin and role = 'admin';
  if v_org is null then
    perform private.fail(403, 'forbidden', 'Admins only');
  end if;

  return query
    select cr.collected_by, p.full_name, count(*), sum(cr.amount_inr)::bigint
    from public.cash_receipts cr
    join public.profiles p on p.id = cr.collected_by
    join public.organizations o on o.id = cr.org_id
    where cr.org_id = v_org and (cr.created_at at time zone o.timezone)::date between p_from and p_to
    group by cr.collected_by, p.full_name
    order by sum(cr.amount_inr) desc;
end;
$$;

revoke execute on function public.cash_report_by_staff(date, date) from public, anon;
grant execute on function public.cash_report_by_staff(date, date) to authenticated;

create function public.cash_report_by_doctor(p_from date, p_to date)
returns table (doctor_id uuid, doctor_name text, receipt_count bigint, total_inr bigint)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_org uuid;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  select org_id into v_org from public.profiles where id = v_admin and role = 'admin';
  if v_org is null then
    perform private.fail(403, 'forbidden', 'Admins only');
  end if;

  return query
    select cr.doctor_id, d.name, count(*), sum(cr.amount_inr)::bigint
    from public.cash_receipts cr
    left join public.doctors d on d.id = cr.doctor_id
    join public.organizations o on o.id = cr.org_id
    where cr.org_id = v_org and (cr.created_at at time zone o.timezone)::date between p_from and p_to
    group by cr.doctor_id, d.name
    order by sum(cr.amount_inr) desc;
end;
$$;

revoke execute on function public.cash_report_by_doctor(date, date) from public, anon;
grant execute on function public.cash_report_by_doctor(date, date) to authenticated;
