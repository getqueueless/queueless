create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  name text not null,
  specialty text not null,
  qualification text,
  room text,
  photo_url text,
  fee_inr int not null default 0 check (fee_inr >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index doctors_org_id_idx on public.doctors (org_id);
create index doctors_service_id_idx on public.doctors (service_id);

-- A doctor can have multiple shifts per day (e.g. 09:00-13:00 and 17:00-20:00), so no unique
-- constraint on (doctor_id, weekday) -- just an index for the generator's lookups.
create table public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  max_patients int not null check (max_patients > 0),
  slot_minutes int not null default 15 check (slot_minutes > 0),
  created_at timestamptz not null default now()
);

create index doctor_schedules_doctor_weekday_idx on public.doctor_schedules (doctor_id, weekday);

create table public.doctor_breaks (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time)
);

create index doctor_breaks_doctor_weekday_idx on public.doctor_breaks (doctor_id, weekday);

create table public.doctor_leaves (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  reason text
);

create index doctor_leaves_doctor_idx on public.doctor_leaves (doctor_id, from_date, to_date);

-- One row per doctor, always meant to describe *today*. A stale row from a previous day reads
-- back as 'available' through doctor_status_today below, rather than needing a midnight reset
-- job -- a doctor who was running_late yesterday doesn't silently stay running_late today.
create table public.doctor_status (
  doctor_id uuid primary key references public.doctors (id) on delete cascade,
  day date not null,
  status text not null default 'available'
    check (status in ('available', 'running_late', 'on_break', 'off')),
  late_minutes int check (late_minutes is null or late_minutes > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create function private.doctors_seed_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.doctor_status (doctor_id, day) values (new.id, current_date);
  return new;
end;
$$;

revoke execute on function private.doctors_seed_status() from public, anon, authenticated;

create trigger doctors_seed_status
  after insert on public.doctors
  for each row execute function private.doctors_seed_status();

-- private.service_day never got an explicit grant when 0008 created it (before 0029's
-- default-privilege revoke existed, and that revoke is prospective only, not retroactive) --
-- harmless everywhere it's been used so far because every existing caller is itself SECURITY
-- DEFINER (runs as postgres, the function's owner, regardless of grants). doctor_status_today
-- below is a `security_invoker = on` view, so its own function calls are checked against the
-- actual querying role, not the view owner -- the first real caller of private.service_day
-- that isn't already running as postgres. Grant it here rather than working around it.
grant execute on function private.service_day(uuid, timestamptz) to anon, authenticated;

create view public.doctor_status_today as
select
  d.id as doctor_id,
  d.org_id,
  case when ds.day = private.service_day(d.org_id, now()) then ds.status else 'available' end as status,
  case when ds.day = private.service_day(d.org_id, now()) then ds.late_minutes else null end as late_minutes
from public.doctors d
left join public.doctor_status ds on ds.doctor_id = d.id;

alter view public.doctor_status_today set (security_invoker = on);

-- ---- Admin CRUD: org-scoped, audited by the generic audit trigger, same pattern as
-- services/counters. Doctors are soft-deactivated (active=false) via upsert, never hard-
-- deleted, so history (tokens, schedules, past status) stays intact -- same pattern as
-- services.is_open/counters.state elsewhere in this schema.
create function public.admin_upsert_doctor(
  p_id uuid, p_service_id uuid, p_name text, p_specialty text,
  p_qualification text default null, p_room text default null, p_photo_url text default null,
  p_fee_inr int default 0, p_active boolean default true
)
returns public.doctors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_service public.services;
  v_doctor public.doctors;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_service from public.services where id = p_service_id;
  if v_service.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles where id = v_admin and org_id = v_service.org_id and role = 'admin'
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  if p_id is null then
    insert into public.doctors (org_id, service_id, name, specialty, qualification, room, photo_url, fee_inr, active)
    values (v_service.org_id, p_service_id, p_name, p_specialty, p_qualification, p_room, p_photo_url, p_fee_inr, p_active)
    returning * into v_doctor;
  else
    update public.doctors set
      service_id = p_service_id, name = p_name, specialty = p_specialty, qualification = p_qualification,
      room = p_room, photo_url = p_photo_url, fee_inr = p_fee_inr, active = p_active
    where id = p_id and org_id = v_service.org_id
    returning * into v_doctor;
    if v_doctor.id is null then
      perform private.fail(404, 'not_found', 'We could not find that');
    end if;
  end if;

  return v_doctor;
end;
$$;

revoke execute on function public.admin_upsert_doctor(uuid, uuid, text, text, text, text, text, int, boolean)
  from public, anon;
grant execute on function public.admin_upsert_doctor(uuid, uuid, text, text, text, text, text, int, boolean)
  to authenticated;

create function private.assert_admin_owns_doctor(p_admin uuid, p_doctor uuid)
returns public.doctors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doctor public.doctors;
begin
  select * into v_doctor from public.doctors where id = p_doctor;
  if v_doctor.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if not exists (
    select 1 from public.profiles where id = p_admin and org_id = v_doctor.org_id and role = 'admin'
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;
  return v_doctor;
end;
$$;

revoke execute on function private.assert_admin_owns_doctor(uuid, uuid) from public, anon, authenticated;

create function public.admin_upsert_doctor_schedule(
  p_id uuid, p_doctor_id uuid, p_weekday smallint, p_start_time time, p_end_time time,
  p_max_patients int, p_slot_minutes int default 15
)
returns public.doctor_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.doctor_schedules;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  perform private.assert_admin_owns_doctor(v_admin, p_doctor_id);

  if p_id is null then
    insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, max_patients, slot_minutes)
    values (p_doctor_id, p_weekday, p_start_time, p_end_time, p_max_patients, p_slot_minutes)
    returning * into v_row;
  else
    update public.doctor_schedules set
      weekday = p_weekday, start_time = p_start_time, end_time = p_end_time,
      max_patients = p_max_patients, slot_minutes = p_slot_minutes
    where id = p_id and doctor_id = p_doctor_id
    returning * into v_row;
    if v_row.id is null then
      perform private.fail(404, 'not_found', 'We could not find that');
    end if;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, new)
  select org_id, 'doctor_schedules', v_row.id, 'upsert', to_jsonb(v_row) from public.doctors where id = p_doctor_id;

  return v_row;
end;
$$;

revoke execute on function public.admin_upsert_doctor_schedule(uuid, uuid, smallint, time, time, int, int)
  from public, anon;
grant execute on function public.admin_upsert_doctor_schedule(uuid, uuid, smallint, time, time, int, int)
  to authenticated;

create function public.admin_delete_doctor_schedule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_doctor_id uuid;
  v_doctor public.doctors;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select doctor_id into v_doctor_id from public.doctor_schedules where id = p_id;
  if v_doctor_id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  v_doctor := private.assert_admin_owns_doctor(v_admin, v_doctor_id);

  delete from public.doctor_schedules where id = p_id;
  insert into public.audit_log (org_id, entity, entity_id, action)
  values (v_doctor.org_id, 'doctor_schedules', p_id, 'delete');
end;
$$;

revoke execute on function public.admin_delete_doctor_schedule(uuid) from public, anon;
grant execute on function public.admin_delete_doctor_schedule(uuid) to authenticated;

create function public.admin_upsert_doctor_break(
  p_id uuid, p_doctor_id uuid, p_weekday smallint, p_start_time time, p_end_time time
)
returns public.doctor_breaks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.doctor_breaks;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  perform private.assert_admin_owns_doctor(v_admin, p_doctor_id);

  if p_id is null then
    insert into public.doctor_breaks (doctor_id, weekday, start_time, end_time)
    values (p_doctor_id, p_weekday, p_start_time, p_end_time)
    returning * into v_row;
  else
    update public.doctor_breaks set weekday = p_weekday, start_time = p_start_time, end_time = p_end_time
    where id = p_id and doctor_id = p_doctor_id
    returning * into v_row;
    if v_row.id is null then
      perform private.fail(404, 'not_found', 'We could not find that');
    end if;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.admin_upsert_doctor_break(uuid, uuid, smallint, time, time) from public, anon;
grant execute on function public.admin_upsert_doctor_break(uuid, uuid, smallint, time, time) to authenticated;

create function public.admin_delete_doctor_break(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_doctor_id uuid;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  select doctor_id into v_doctor_id from public.doctor_breaks where id = p_id;
  if v_doctor_id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  perform private.assert_admin_owns_doctor(v_admin, v_doctor_id);
  delete from public.doctor_breaks where id = p_id;
end;
$$;

revoke execute on function public.admin_delete_doctor_break(uuid) from public, anon;
grant execute on function public.admin_delete_doctor_break(uuid) to authenticated;

create function public.admin_upsert_doctor_leave(
  p_id uuid, p_doctor_id uuid, p_from_date date, p_to_date date, p_reason text default null
)
returns public.doctor_leaves
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.doctor_leaves;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  perform private.assert_admin_owns_doctor(v_admin, p_doctor_id);

  if p_id is null then
    insert into public.doctor_leaves (doctor_id, from_date, to_date, reason)
    values (p_doctor_id, p_from_date, p_to_date, p_reason)
    returning * into v_row;
  else
    update public.doctor_leaves set from_date = p_from_date, to_date = p_to_date, reason = p_reason
    where id = p_id and doctor_id = p_doctor_id
    returning * into v_row;
    if v_row.id is null then
      perform private.fail(404, 'not_found', 'We could not find that');
    end if;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.admin_upsert_doctor_leave(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.admin_upsert_doctor_leave(uuid, uuid, date, date, text) to authenticated;

create function public.admin_delete_doctor_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_doctor_id uuid;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  select doctor_id into v_doctor_id from public.doctor_leaves where id = p_id;
  if v_doctor_id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  perform private.assert_admin_owns_doctor(v_admin, v_doctor_id);
  delete from public.doctor_leaves where id = p_id;
end;
$$;

revoke execute on function public.admin_delete_doctor_leave(uuid) from public, anon;
grant execute on function public.admin_delete_doctor_leave(uuid) to authenticated;

-- Staff or admin (not admin-only, per spec) -- upserts today's status. day is always stamped
-- as the org's own service day, never trusted from the caller.
create function public.set_doctor_status(p_doctor uuid, p_status text, p_late_minutes int default null)
returns public.doctor_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_doctor public.doctors;
  v_row public.doctor_status;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if p_status not in ('available', 'running_late', 'on_break', 'off') then
    perform private.fail(400, 'invalid_status', 'Unknown doctor status');
  end if;
  if p_status = 'running_late' and (p_late_minutes is null or p_late_minutes <= 0) then
    perform private.fail(400, 'invalid_status', 'running_late needs a positive minute count');
  end if;

  select * into v_doctor from public.doctors where id = p_doctor;
  if v_doctor.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = v_doctor.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  insert into public.doctor_status (doctor_id, day, status, late_minutes, updated_at, updated_by)
  values (p_doctor, private.service_day(v_doctor.org_id, now()), p_status,
          case when p_status = 'running_late' then p_late_minutes else null end, now(), v_staff)
  on conflict (doctor_id) do update set
    day = excluded.day, status = excluded.status, late_minutes = excluded.late_minutes,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.audit_log (org_id, entity, entity_id, action, new)
  values (v_doctor.org_id, 'doctor_status', p_doctor, 'set_status', to_jsonb(v_row));

  return v_row;
end;
$$;

revoke execute on function public.set_doctor_status(uuid, text, int) from public, anon;
grant execute on function public.set_doctor_status(uuid, text, int) to authenticated;

-- Public read (patients pick a doctor when booking), RPC-only write -- same split as
-- tokens/appointments, not the direct-admin-write split organizations/services/counters use,
-- because every write here already goes through the admin RPCs above; a second, separate RLS
-- write policy would just be the same "is org admin" check duplicated and free to drift.
alter table public.doctors enable row level security;
alter table public.doctor_schedules enable row level security;
alter table public.doctor_breaks enable row level security;
alter table public.doctor_leaves enable row level security;
alter table public.doctor_status enable row level security;

revoke all on public.doctors, public.doctor_schedules, public.doctor_breaks,
  public.doctor_leaves, public.doctor_status from public, anon, authenticated;
grant select on public.doctors, public.doctor_schedules, public.doctor_breaks,
  public.doctor_leaves, public.doctor_status to anon, authenticated;
grant select on public.doctor_status_today to anon, authenticated;

create policy doctors_read on public.doctors for select to anon, authenticated using (true);
create policy doctor_schedules_read on public.doctor_schedules for select to anon, authenticated using (true);
create policy doctor_breaks_read on public.doctor_breaks for select to anon, authenticated using (true);
create policy doctor_leaves_read on public.doctor_leaves for select to anon, authenticated using (true);
create policy doctor_status_read on public.doctor_status for select to anon, authenticated using (true);
