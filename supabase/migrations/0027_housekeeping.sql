create extension if not exists pg_cron;

create function private.housekeeping(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- 1. Booked appointments past starts_at + 15min -> no_show
  for r in
    select a.id from public.appointments a
    join public.appointment_slots sl on sl.id = a.slot_id
    where a.status = 'booked' and sl.starts_at + interval '15 minutes' < p_now
    for no key update of a skip locked
  loop
    update public.appointments set status = 'no_show' where id = r.id;
  end loop;

  -- 2. Reminder notifications for bookings starting within 30 minutes
  insert into public.notifications (patient_id, appointment_id, kind, title, body)
  select a.patient_id, a.id, 'appointment_reminder', 'Upcoming appointment',
         'Your appointment is coming up soon'
  from public.appointments a
  join public.appointment_slots sl on sl.id = a.slot_id
  where a.status = 'booked'
    and sl.starts_at between p_now and p_now + interval '30 minutes'
  on conflict do nothing;

  -- 3. called tokens older than services.no_show_minutes -> no_show
  for r in
    select t.id, t.patient_id from public.tokens t
    join public.services s on s.id = t.service_id
    where t.status = 'called'
      and t.called_at < p_now - make_interval(mins => s.no_show_minutes)
    for no key update of t skip locked
  loop
    update public.tokens set status = 'no_show' where id = r.id;
    if r.patient_id is not null then
      insert into public.notifications (patient_id, token_id, kind, title, body)
      values (r.patient_id, r.id, 'no_show', 'Marked as no-show',
              'You were marked as a no-show since you did not respond in time')
      on conflict do nothing;
    end if;
  end loop;

  -- 4. Tokens from earlier service days
  for r in
    select t.id, t.status, t.patient_id, t.org_id from public.tokens t
    where t.status in ('waiting', 'called', 'serving')
      and t.service_day < private.service_day(t.org_id, p_now)
    for no key update of t skip locked
  loop
    if r.status = 'waiting' then
      update public.tokens set status = 'cancelled' where id = r.id;
      if r.patient_id is not null then
        insert into public.notifications (patient_id, token_id, kind, title, body)
        values (r.patient_id, r.id, 'expired', 'Ticket expired',
                'Your ticket from a previous day was cancelled')
        on conflict do nothing;
      end if;
    elsif r.status = 'called' then
      update public.tokens set status = 'no_show' where id = r.id;
    elsif r.status = 'serving' then
      update public.tokens set status = 'done', finished_at = p_now where id = r.id;
      insert into public.audit_log (org_id, entity, entity_id, action, old, new)
      values (r.org_id, 'tokens', r.id, 'auto_closed', null, null);
    end if;
  end loop;
end;
$$;

revoke execute on function private.housekeeping(timestamptz) from public, anon, authenticated;

select cron.schedule('queueless-housekeeping', '30 seconds', $$select private.housekeeping()$$);
select cron.schedule('queueless-housekeeping-cleanup', '0 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 hour'$$);
