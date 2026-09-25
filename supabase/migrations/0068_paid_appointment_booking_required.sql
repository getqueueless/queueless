-- Product rule (Yash): a patient must not be able to book an appointment slot for free -- no
-- book-and-cancel griefing against doctor availability. Payment work's start_paid_appointment
-- (0057) already holds a slot (pending_payment, 10 min) and takes it through record_order/
-- confirm_payment the same way a walk-in token does; book_appointment (0013, doctor-aware since
-- 0039) is the free path that predates it and is still reachable directly. Read 0057 in full
-- before writing this, specifically so this doesn't clash with it: start_paid_appointment is
-- untouched here except for the new anti-hoarding count below, and both functions keep their own
-- names -- coordinated with Payment work rather than renaming/merging either.
--
-- book_appointment stays open to staff/admin (walk-in/phone bookings, where a human takes
-- payment or none is owed) -- the block is specifically on the CALLER's own role, checked via
-- private.my_role() (0029), not on the slot or doctor. A patient hitting this now gets a real
-- 402 pointing at the paid flow, not a confusing generic error.
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

  if private.my_role() = 'patient' then
    perform private.fail(402, 'payment_required', 'Booking this appointment requires payment -- use the paid booking flow');
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

-- Anti-hoarding: a patient could otherwise hold up to one pending_payment slot per service
-- (already_booked only blocks a SECOND hold for the SAME service) across every service/doctor at
-- once -- 4 services means 4 real slots denied to other patients for 10 minutes each, for zero
-- cost. Capped at 2 unpaid holds total, across services/orgs, not just this one. Placed right
-- before the slot-capacity update (same spot book_appointment's own limit checks live), so a
-- patient already at the cap never touches (and never decrements) a slot's booked count.
create or replace function public.start_paid_appointment(p_slot uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_slot public.appointment_slots;
  v_service public.services;
  v_doctor public.doctors;
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
  if v_slot.doctor_id is null then
    perform private.fail(409, 'no_doctor_for_slot', 'This slot has no doctor assigned to bill against');
  end if;

  select * into v_doctor from public.doctors where id = v_slot.doctor_id;
  if v_doctor.id is null or not v_doctor.active then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if v_doctor.fee_inr <= 0 then
    perform private.fail(409, 'not_payable', 'This doctor has no online fee configured');
  end if;

  select * into v_service from public.services where id = v_slot.service_id;

  if exists (
    select 1 from public.doctor_leaves dl
    where dl.doctor_id = v_slot.doctor_id
      and private.service_day(v_service.org_id, v_slot.starts_at) between dl.from_date and dl.to_date
  ) then
    perform private.fail(409, 'doctor_on_leave', 'This doctor is on leave that day');
  end if;

  select * into v_existing from public.appointments
    where patient_id = v_patient and service_id = v_slot.service_id and status in ('pending_payment', 'booked')
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

  select count(*) into v_count
    from public.appointments
    where patient_id = v_patient and status = 'pending_payment';
  if v_count >= 2 then
    perform private.fail(409, 'too_many_holds', 'You already have 2 unpaid holds -- pay or let one expire before starting another');
  end if;

  update public.appointment_slots
    set booked = booked + 1
    where id = p_slot and booked < capacity;
  if not found then
    perform private.fail(409, 'slot_full', 'That slot just filled up');
  end if;

  insert into public.appointments (slot_id, service_id, patient_id, status, doctor_id, fee_inr, hold_expires_at)
  values (p_slot, v_slot.service_id, v_patient, 'pending_payment', v_slot.doctor_id, v_doctor.fee_inr, now() + interval '10 minutes')
  returning * into v_appt;

  return v_appt;
end;
$$;
