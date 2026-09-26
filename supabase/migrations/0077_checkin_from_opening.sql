-- Booked patients join the queue from the moment the hospital opens on the
-- day of their appointment, not only 30 minutes before the slot: check_in
-- now accepts any time on the slot's own service day (the org's local day,
-- private.service_day) until 15 minutes after the slot. Queue order is
-- unchanged: the token's priority_at is still greatest(slot start, now()),
-- so an early check-in holds a place in slot order, it does not jump ahead.
-- Same function as 0074 otherwise; only the window check changed.

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

  if private.service_day(v_service.org_id, now()) <> private.service_day(v_service.org_id, v_slot.starts_at)
     or now() > v_slot.starts_at + interval '15 minutes' then
    perform private.fail(409, 'checkin_window', 'Check-in opens on the day of your appointment and closes 15 minutes after your slot');
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
