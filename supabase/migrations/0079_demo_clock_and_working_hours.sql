-- Demo clock: 0075 added a doctor working-hours gate on walk-in bookings, then 0076 reverted it
-- same sitting because the judging demo ran before any doctor's real shift started and the gate
-- would have 409'd every walk-in. This is the fix that was deferred, not just a repeat of 0075:
-- an org-wide fake "now" admin can set for a demo, so the gate (and anything else that reads it)
-- checks against that instead of the wall clock, without touching real timestamps anywhere else
-- (payments, holds, audit_log, ML timing all keep using clock_timestamp()/now() -- only the
-- doctor-hours question below is demo-clock-aware).
alter table public.organizations add column demo_clock_at timestamptz;
alter table public.organizations add column demo_clock_set_at timestamptz;

-- organizations grants UPDATE table-wide to authenticated (0030), with RLS restricting rows to
-- the caller's own org and admin role (organizations_admin_update) -- fine for the existing
-- columns, but these two should only ever move through set_demo_clock below, which stamps
-- demo_clock_set_at from the server's own clock. A direct client update could send a stale or
-- spoofed set_at and make org_now() drift or jump.
revoke update (demo_clock_at, demo_clock_set_at) on public.organizations from authenticated;

-- The effective "now" for anything demo-clock-aware. Real time when no demo clock is set;
-- otherwise the fake time, ticking forward at the same rate as the wall clock from the moment it
-- was set (not frozen), so a demo running long doesn't leave the clock stuck at the set instant.
create function private.org_now(p_org_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when demo_clock_at is not null then demo_clock_at + (clock_timestamp() - demo_clock_set_at)
            else clock_timestamp() end
     from public.organizations where id = p_org_id),
    clock_timestamp()
  );
$$;

revoke execute on function private.org_now(uuid) from public, anon;
grant execute on function private.org_now(uuid) to authenticated;

-- Admin-only, own org only (private.my_org()/my_role(), the same helpers organizations_admin_update
-- uses). p_at null clears the demo clock back to real time.
create function public.set_demo_clock(p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  if private.my_role() <> 'admin' then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  update public.organizations
    set demo_clock_at = p_at, demo_clock_set_at = case when p_at is null then null else clock_timestamp() end
    where id = private.my_org();
  if not found then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
end;
$$;

revoke execute on function public.set_demo_clock(timestamptz) from public, anon;
grant execute on function public.set_demo_clock(timestamptz) to authenticated;

-- Re-add 0075's walk-in working-hours gate, org_now()-aware this time: same 60-before-start to
-- 30-before-end window, but every "now"/"today" in the check reads through org_now() and its
-- service_day, so setting a demo clock to (say) 8:45 AM makes a 9 AM shift bookable, and setting
-- it to a different weekday evaluates that weekday's schedule.
do $$
declare
  v_def text;
  v_new text;
  v_old constant text := $q$  select * into v_existing from public.tokens
    where patient_id = v_patient and service_id = v_service.id$q$;
  v_gate constant text := $q$  if not exists (
    select 1
    from public.doctor_schedules ds
    join public.organizations o on o.id = v_service.org_id
    where ds.doctor_id = p_doctor_id
      and ds.weekday = extract(dow from private.service_day(v_service.org_id, private.org_now(v_service.org_id)))::smallint
      and private.org_now(v_service.org_id) >= ((private.service_day(v_service.org_id, private.org_now(v_service.org_id))::text || ' ' || ds.start_time::text)::timestamp at time zone o.timezone) - interval '60 minutes'
      and private.org_now(v_service.org_id) <= ((private.service_day(v_service.org_id, private.org_now(v_service.org_id))::text || ' ' || ds.end_time::text)::timestamp at time zone o.timezone) - interval '30 minutes'
  ) then
    perform private.fail(409, 'outside_hours', 'This doctor is not accepting walk-ins right now');
  end if;

$q$;
begin
  v_def := pg_get_functiondef('public.start_paid_booking'::regproc);
  if position(v_old in v_def) = 0 then
    raise exception '0079: insertion point not found in start_paid_booking';
  end if;
  if position('outside_hours' in v_def) > 0 then
    raise exception '0079: outside_hours gate already present, refusing to double-insert';
  end if;
  v_new := replace(v_def, v_old, v_gate || v_old);
  execute v_new;
end;
$$;
