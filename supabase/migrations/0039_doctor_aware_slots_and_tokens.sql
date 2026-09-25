-- appointment_slots.doctor_id is nullable at the column level, not NOT NULL: this system has
-- never deployed doctors before, and any appointment_slots rows created by the old service-
-- level seed generation (before this migration) have no doctor to backfill from. "Every newly
-- generated slot has a doctor" is enforced by private.generate_doctor_slots below (the only
-- thing that creates slots from here on), not by a table constraint that would need a risky
-- backfill-or-delete of whatever already exists in a real deployment.
alter table public.appointment_slots add column doctor_id uuid references public.doctors (id) on delete cascade;
create index appointment_slots_doctor_id_idx on public.appointment_slots (doctor_id);

-- The old unique(service_id, starts_at) (0005) blocks exactly what this feature needs: two
-- different doctors of the same service both having a slot at, say, 09:00. Replace it with
-- unique(doctor_id, starts_at) -- Postgres unique constraints never conflict on NULL, so old
-- doctor-less rows (if any survive a real deployment) are unaffected either way.
alter table public.appointment_slots drop constraint appointment_slots_service_id_starts_at_key;
create unique index appointment_slots_doctor_starts_at_key on public.appointment_slots (doctor_id, starts_at)
  where doctor_id is not null;

-- null = "any available doctor in this department", both for a walk-in patient's own
-- issue_token (no doctor picker in that flow) and for a counter with no specific doctor bound.
alter table public.tokens add column doctor_id uuid references public.doctors (id) on delete set null;
alter table public.appointments add column doctor_id uuid references public.doctors (id) on delete set null;
alter table public.counters add column doctor_id uuid references public.doctors (id) on delete set null;
create index tokens_doctor_id_idx on public.tokens (doctor_id);

-- Walks each day in range: finds that weekday's schedule rows (a doctor can have several
-- shifts/day), steps start_time..end_time by slot_minutes, skips any slot whose interval
-- overlaps a break on that weekday, skips the whole day if it falls inside a leave. Idempotent
-- (ON CONFLICT DO NOTHING against the doctor_id+starts_at key above) -- safe to re-run for an
-- overlapping range, e.g. extending the generated window forward by a day at a time.
create function private.generate_doctor_slots(p_doctor_id uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doctor public.doctors;
  v_org public.organizations;
  v_day date;
  v_sched record;
  v_slot_start time;
  v_starts_at timestamptz;
  v_count int := 0;
begin
  select * into v_doctor from public.doctors where id = p_doctor_id;
  if v_doctor.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  select * into v_org from public.organizations where id = v_doctor.org_id;

  v_day := p_from;
  while v_day <= p_to loop
    if not exists (
      select 1 from public.doctor_leaves dl
      where dl.doctor_id = p_doctor_id and v_day between dl.from_date and dl.to_date
    ) then
      for v_sched in
        select * from public.doctor_schedules
        where doctor_id = p_doctor_id and weekday = extract(dow from v_day)::smallint
      loop
        v_slot_start := v_sched.start_time;
        while v_slot_start + make_interval(mins => v_sched.slot_minutes) <= v_sched.end_time loop
          if not exists (
            select 1 from public.doctor_breaks db
            where db.doctor_id = p_doctor_id and db.weekday = v_sched.weekday
              and v_slot_start < db.end_time
              and v_slot_start + make_interval(mins => v_sched.slot_minutes) > db.start_time
          ) then
            v_starts_at := (v_day::text || ' ' || v_slot_start::text)::timestamp at time zone v_org.timezone;
            insert into public.appointment_slots (service_id, doctor_id, starts_at, capacity)
            values (v_doctor.service_id, p_doctor_id, v_starts_at, v_sched.max_patients)
            on conflict (doctor_id, starts_at) where doctor_id is not null do nothing;
            if found then
              v_count := v_count + 1;
            end if;
          end if;
          v_slot_start := v_slot_start + make_interval(mins => v_sched.slot_minutes);
        end loop;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function private.generate_doctor_slots(uuid, date, date) from public, anon, authenticated;

-- Callable by an org admin (seed.sh/demo-reset.sh call it as postgres directly; this wrapper is
-- for the admin app to regenerate a doctor's slots without a DB console).
create function public.admin_generate_doctor_slots(p_doctor_id uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  perform private.assert_admin_owns_doctor(v_admin, p_doctor_id);
  return private.generate_doctor_slots(p_doctor_id, p_from, p_to);
end;
$$;

revoke execute on function public.admin_generate_doctor_slots(uuid, date, date) from public, anon;
grant execute on function public.admin_generate_doctor_slots(uuid, date, date) to authenticated;

-- mint_token, book_appointment, check_in, call_next redefined (CREATE OR REPLACE, not editing
-- 0009/0013/0014/0020's files) with doctor_id threaded through. Every body below is otherwise
-- unchanged from what's live today -- verified against pg_get_functiondef before writing this.
-- CREATE OR REPLACE alone would NOT touch the old 8-arg version below -- adding a parameter
-- changes the function's identity (its signature), so Postgres would keep both side by side as
-- overloads, and any 8-positional-arg caller (every existing one) would then fail with "is not
-- unique" (confirmed: exactly what happened before this DROP was added). Drop the old signature
-- explicitly first, so the 9-arg version (last param defaulted) is the only candidate left.
drop function private.mint_token(uuid, uuid, public.lane, uuid, text, uuid, timestamptz, uuid);

create function private.mint_token(
  p_org uuid, p_service uuid, p_lane public.lane, p_patient uuid, p_walk_in_label text,
  p_appointment uuid, p_arrival timestamptz, p_issued_by uuid, p_doctor_id uuid default null
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
    status, patient_id, walk_in_label, issued_by, appointment_id, doctor_id
  ) values (
    p_org, p_service, v_day, v_num, v_code, p_lane, v_lane_rank, p_arrival,
    'waiting', p_patient, p_walk_in_label, p_issued_by, p_appointment, p_doctor_id
  )
  returning * into v_token;

  return v_token;
end;
$$;

revoke execute on function private.mint_token(uuid, uuid, public.lane, uuid, text, uuid, timestamptz, uuid, uuid)
  from public, anon, authenticated;

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

  insert into public.appointments (slot_id, service_id, patient_id, status, doctor_id)
  values (p_slot, v_slot.service_id, v_patient, 'booked', v_slot.doctor_id)
  returning * into v_appt;

  return v_appt;
end;
$$;

revoke execute on function public.book_appointment(uuid) from public, anon;
grant execute on function public.book_appointment(uuid) to authenticated;

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

  update public.appointments set status = 'checked_in', token_id = v_token.id where id = p_appointment;

  return v_token;
end;
$$;

revoke execute on function public.check_in(uuid) from public, anon;
grant execute on function public.check_in(uuid) to authenticated;

-- call_next: a doctor-bound counter (c.doctor_id is not null) pulls that doctor's own tokens
-- PLUS "any doctor" tokens (t.doctor_id is null); an unbound counter keeps its old behaviour
-- unchanged (every waiting token for its services, regardless of doctor). Lane/priority
-- ordering and FOR NO KEY UPDATE ... SKIP LOCKED are untouched.
create or replace function public.call_next(p_counter uuid)
returns setof public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  c public.counters;
  v_busy public.tokens;
  v_token public.tokens;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into c from public.counters where id = p_counter for update;

  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = c.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  if c.state <> 'open' then
    perform private.fail(409, 'counter_closed', 'That desk is closed');
  end if;

  select * into v_busy from public.tokens
    where counter_id = p_counter and status in ('called', 'serving')
    limit 1;
  if v_busy.id is not null then
    perform private.fail(409, 'counter_busy', 'That desk is already serving someone',
      null, json_build_object('token_id', v_busy.id, 'code', v_busy.code)::jsonb);
  end if;

  update public.tokens
    set status = 'called', counter_id = p_counter, called_at = now()
    where id = (
      select t.id from public.tokens t
      where t.org_id = c.org_id
        and t.service_id in (select cs.service_id from public.counter_services cs where cs.counter_id = p_counter)
        and t.service_day = private.service_day(c.org_id, now())
        and t.status = 'waiting'
        and (c.doctor_id is null or t.doctor_id is null or t.doctor_id = c.doctor_id)
      order by t.lane_rank, t.priority_at, t.number
      limit 1
      for no key update of t skip locked
    )
    returning * into v_token;

  if v_token.id is not null then
    return next v_token;
  end if;
  return;
end;
$$;

revoke execute on function public.call_next(uuid) from public, anon;
grant execute on function public.call_next(uuid) to authenticated;

-- appointment_slots has had RLS off since 0005, with Postgres's original default grant of full
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE to anon and authenticated, unrevoked -- confirmed live
-- (any signed-in patient could directly zero out a full slot's `booked` count, or write a slot
-- with any doctor/time, bypassing book_appointment entirely). This migration is what gives the
-- table real product weight (doctor binding, capacity from a real schedule), and apps/mobile's
-- only touch on it is a plain `.select('*')` (checked), so lock it down here rather than leave
-- the feature this migration just built pointless from a security standpoint. Same split as
-- doctors/tokens: public read, RPC-only write (book_appointment, cancel_appointment,
-- private.generate_doctor_slots are all SECURITY DEFINER and unaffected by this).
-- profiles/tokens/appointments/audit_log stay OUT of scope here -- apps/web reads tokens
-- directly for its live dashboard, and locking those down safely needs checking every such read
-- first; that's the separately-tracked RLS follow-up, not this migration.
alter table public.appointment_slots enable row level security;
revoke all on public.appointment_slots from public, anon, authenticated;
grant select on public.appointment_slots to anon, authenticated;
create policy appointment_slots_read on public.appointment_slots for select to anon, authenticated using (true);
