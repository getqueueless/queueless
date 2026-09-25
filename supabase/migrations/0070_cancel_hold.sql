-- Patient dashboard flagged a real gap: nothing let a patient release their own unpaid hold.
-- cancel_appointment (0013) only accepts status = 'booked'; cancel_token (0011) only accepts
-- status = 'waiting'. Neither touches 'pending_payment', so /pay's "Cancel booking" and /my's
-- Cancel button both silently fail (illegal_transition) on any hold created by
-- start_paid_appointment or start_paid_booking. cancel_hold(p_id) is the missing patient-callable
-- release: takes either an appointment id or a token id owned by the caller with status
-- pending_payment, cancels it, and -- for an appointment specifically -- releases the slot
-- capacity start_paid_appointment claimed up front (same as cancel_appointment already does for
-- a confirmed booking). A token hold has nothing to release: mint_token's own number is never
-- reused once issued, gapless by design, same as a plain cancel_token today.
--
-- p_id isn't typed to one table or the other (the caller already knows which they're cancelling,
-- but a single button/RPC name is simpler for the frontend than two near-identical ones) -- tries
-- appointments first, then tokens, and 404s if neither matches this patient's own pending hold.
-- Rate-limited the same as the other patient cancels (10/hour, 0069).
create function public.cancel_hold(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_appt public.appointments;
  v_tok public.tokens;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.check_patient_rate_limit(v_patient, 'cancel_hold', 10, interval '1 hour');

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  update public.appointments
    set status = 'cancelled'
    where id = p_id and patient_id = v_patient and status = 'pending_payment'
    returning * into v_appt;
  if v_appt.id is not null then
    update public.appointment_slots set booked = booked - 1 where id = v_appt.slot_id;
    return jsonb_build_object('kind', 'appointment', 'id', v_appt.id, 'status', v_appt.status);
  end if;

  update public.tokens
    set status = 'cancelled'
    where id = p_id and patient_id = v_patient and status = 'pending_payment'
    returning * into v_tok;
  if v_tok.id is not null then
    return jsonb_build_object('kind', 'token', 'id', v_tok.id, 'status', v_tok.status);
  end if;

  perform private.fail(404, 'not_found', 'We could not find that');
  return null;
end;
$$;

revoke execute on function public.cancel_hold(uuid) from public, anon;
grant execute on function public.cancel_hold(uuid) to authenticated;
