create function private.appointments_state_machine()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> new.status and not (old.status = 'booked' and new.status in ('checked_in', 'cancelled', 'no_show')) then
    perform private.fail(409, 'illegal_transition', 'That booking state change is not allowed');
  end if;
  return new;
end;
$$;

create trigger appointments_state_machine
  before update on public.appointments
  for each row execute function private.appointments_state_machine();

create function public.check_in(p_appointment uuid)
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
    p_appointment, greatest(v_slot.starts_at, now()), null
  );

  update public.appointments set status = 'checked_in', token_id = v_token.id where id = p_appointment;

  return v_token;
end;
$$;

revoke execute on function public.check_in(uuid) from public, anon;
grant execute on function public.check_in(uuid) to authenticated;
