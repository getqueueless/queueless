-- P0, live regression: 0069's own redefinition of cancel_appointment (adding the patient
-- rate-limit check) was written from a stale local copy that predated 0059
-- (cancel_hold_and_refund_policy, Payment work's own migration, landed at a LOWER migration
-- number but pulled into this checkout AFTER 0069 was already drafted) -- it silently dropped
-- 0059's cancel_refund_eligible flagging on cancel. Since 0069 is already pushed and live, every
-- patient-cancelled paid appointment since then has NOT been flagged for auto-refund, regardless
-- of how far ahead of the slot they cancelled. Restored here, verified against 0059's own source
-- rather than reconstructed from memory.
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

  if v_slot.starts_at - now() >= interval '2 hours' then
    update public.payments set cancel_refund_eligible = true
      where appointment_id = p_appointment and status = 'captured';
  end if;

  return v_appt;
end;
$$;
