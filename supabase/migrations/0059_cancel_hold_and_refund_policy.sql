-- Auto-refund policy for a patient-cancelled PAID appointment (orchestrator-relayed policy,
-- 2026-09-26): >= 2 hours before the slot -> automatic full refund, same as a doctor-leave
-- cancellation; later (or a no-show) -> no automatic refund, admin may still approve one
-- manually via /admin/payments. This column just marks eligibility at cancel time -- the actual
-- Razorpay refund call happens in apps/api's refund_job (a plain SQL function has no HTTP
-- access), same split doctor-leave refunds already use.
alter table public.payments add column cancel_refund_eligible boolean not null default false;

-- cancel_appointment (0013) redefined -- body is byte-for-byte what's live today (verified via
-- pg_get_functiondef first) except for the new eligibility check appended at the end.
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

-- doctor_leave_refund_candidates (0057) redefined -- adds a third branch for a patient
-- cancellation flagged eligible above, and a `reason` column so apps/api's refund_job can label
-- the refund correctly instead of hardcoding "doctor on leave" for every candidate.
drop function private.doctor_leave_refund_candidates();

create function private.doctor_leave_refund_candidates()
returns table (payment_id uuid, token_id uuid, doctor_id uuid, org_id uuid, razorpay_payment_id text, amount_inr int, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.token_id, t.doctor_id, p.org_id, p.razorpay_payment_id, p.amount_inr, 'doctor on leave'
  from public.payments p
  join public.tokens t on t.id = p.token_id
  join public.doctors d on d.id = t.doctor_id
  where p.status = 'captured'
    and exists (
      select 1 from public.doctor_leaves dl
      where dl.doctor_id = d.id
        and private.service_day(p.org_id, now()) between dl.from_date and dl.to_date
    )
  union all
  select p.id, null::uuid, a.doctor_id, p.org_id, p.razorpay_payment_id, p.amount_inr, 'doctor on leave'
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  join public.appointment_slots sl on sl.id = a.slot_id
  join public.doctors d on d.id = a.doctor_id
  where p.status = 'captured'
    and exists (
      select 1 from public.doctor_leaves dl
      where dl.doctor_id = d.id
        and private.service_day(p.org_id, sl.starts_at) between dl.from_date and dl.to_date
    )
  union all
  select p.id, null::uuid, a.doctor_id, p.org_id, p.razorpay_payment_id, p.amount_inr, 'cancelled 2+ hours before the appointment'
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where p.status = 'captured' and p.cancel_refund_eligible;
$$;

revoke execute on function private.doctor_leave_refund_candidates() from public, anon, authenticated;
grant execute on function private.doctor_leave_refund_candidates() to queueless_api;
