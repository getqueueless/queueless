-- appointments_state_machine (0014) redefined (CREATE OR REPLACE, not editing 0014's file) to
-- allow pending_payment -> booked (payment confirmed) and pending_payment -> cancelled (hold
-- expired unpaid, or a refund). Same reasoning and discipline as 0052's tokens_state_machine
-- redefinition -- verified against pg_get_functiondef before writing this.
create or replace function private.appointments_state_machine()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> new.status and not (
    (old.status = 'booked' and new.status in ('checked_in', 'cancelled', 'no_show'))
    or (old.status = 'pending_payment' and new.status in ('booked', 'cancelled'))
  ) then
    perform private.fail(409, 'illegal_transition', 'That booking state change is not allowed');
  end if;
  return new;
end;
$$;

-- Same grant tokens already has (queueless_api reads tokens directly for its API routes) --
-- apps/api's /payments/order and /payments/verify need the same direct read on appointments
-- (ownership check via patient_id, fee from fee_inr), same reason. The grant alone is not
-- enough -- RLS with no matching policy silently filters every row for a non-owner role (same
-- trap 0051's payments_api_read policy documents); appointment_slots needs the same pair since
-- record_refund/housekeeping read starts_at off it for the doctor-leave date match.
grant select on public.appointments to queueless_api;
create policy appointments_api_read on public.appointments for select to queueless_api using (true);
grant select on public.appointment_slots to queueless_api;
create policy appointment_slots_api_read on public.appointment_slots for select to queueless_api using (true);

-- Patient-facing: holds a slot for p_doctor_id's online fee, 10 minutes, same shape as
-- start_paid_booking (0052) but reserves an appointment_slots row instead of minting a token --
-- the token itself is only minted at check_in, same as an unpaid appointment today. Modeled on
-- book_appointment's latest body (0039, verified via pg_get_functiondef before writing this),
-- duplicated rather than shared for the same reason start_paid_booking didn't reuse mint_token:
-- the one real difference (status + hold_expires_at + fee_inr at birth) can't cleanly graft onto
-- a function whose every other caller needs the old behaviour.
create function public.start_paid_appointment(p_slot uuid)
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

  -- The slot's own date, not today -- an appointment can be for any future date, so leave has
  -- to be checked against when the appointment actually is, unlike start_paid_booking's
  -- walk-in-today check.
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

revoke execute on function public.start_paid_appointment(uuid) from public, anon;
grant execute on function public.start_paid_appointment(uuid) to authenticated;

-- record_order (0052) redefined with a new signature -- one of p_token/p_appointment is set,
-- never both, matching payments_exactly_one_target (0056). The 3-arg version is dropped
-- explicitly (CREATE OR REPLACE alone would leave it as a stale overload, same reason 0039 had
-- to drop the old mint_token signature) -- apps/api is updated in the same deploy to always pass
-- both positions.
drop function public.record_order(uuid, text, int);

create function public.record_order(p_token uuid, p_appointment uuid, p_razorpay_order_id text, p_amount_inr int)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_fee int;
  v_payment public.payments;
begin
  if p_token is not null then
    select org_id, status::text, fee_inr into v_org, v_status, v_fee from public.tokens where id = p_token;
  elsif p_appointment is not null then
    select o.id, a.status::text, a.fee_inr into v_org, v_status, v_fee
      from public.appointments a
      join public.services s on s.id = a.service_id
      join public.organizations o on o.id = s.org_id
      where a.id = p_appointment;
  else
    return null;
  end if;

  if v_org is null or v_status <> 'pending_payment' then
    return null;
  end if;
  if v_fee is distinct from p_amount_inr then
    return null;
  end if;

  insert into public.payments (org_id, token_id, appointment_id, razorpay_order_id, amount_inr, status)
  values (v_org, p_token, p_appointment, p_razorpay_order_id, p_amount_inr, 'created')
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke execute on function public.record_order(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.record_order(uuid, uuid, text, int) to queueless_api;

-- confirm_payment (0052) redefined -- same signature, body now branches on which of
-- token_id/appointment_id the payments row actually targets. Idempotency and the amount check
-- are unchanged.
create or replace function public.confirm_payment(p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_inr int)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where razorpay_order_id = p_razorpay_order_id for update;
  if v_payment.id is null then
    return null;
  end if;

  if v_payment.status = 'captured' then
    if v_payment.razorpay_payment_id is distinct from p_razorpay_payment_id then
      return null;
    end if;
    return v_payment;
  end if;

  if v_payment.status <> 'created' then
    return null;
  end if;
  if v_payment.amount_inr is distinct from p_amount_inr then
    return null;
  end if;

  update public.payments
    set status = 'captured', razorpay_payment_id = p_razorpay_payment_id, captured_at = now()
    where id = v_payment.id
    returning * into v_payment;

  if v_payment.token_id is not null then
    update public.tokens set status = 'waiting' where id = v_payment.token_id and status = 'pending_payment';
  elsif v_payment.appointment_id is not null then
    update public.appointments set status = 'booked' where id = v_payment.appointment_id and status = 'pending_payment';
  end if;
  -- ponytail: same documented edge as 0052 -- if the 10-minute hold already expired before this
  -- lands, the token/appointment is not resurrected, only the payment stays captured for manual
  -- reconciliation.

  return v_payment;
end;
$$;

-- record_refund (0052/0054) redefined -- on a successful refund, also releases whatever the
-- payment was holding: a token goes to 'cancelled' (waiting -> cancelled is already a legal
-- transition, 0022), an appointment goes to 'cancelled' and its slot's booked count is freed for
-- someone else. A refunded booking that still occupies a queue slot or a doctor's calendar slot
-- would be wrong regardless of which entity type it is -- this closes that gap for both at once
-- rather than leaving tokens as the one case that doesn't self-release (0052 shipped before
-- appointments needed the same treatment, and never went back to add it for tokens either).
create or replace function public.record_refund(
  p_payment_id uuid, p_razorpay_refund_id text, p_reason text, p_initiated_by uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_slot_id uuid;
begin
  update public.payments
    set status = 'refunded', razorpay_refund_id = p_razorpay_refund_id,
        refund_reason = p_reason, refunded_at = now(), initiated_by = p_initiated_by
    where id = p_payment_id and status = 'captured'
    returning * into v_payment;

  if v_payment.id is null then
    return null;
  end if;

  if v_payment.token_id is not null then
    update public.tokens set status = 'cancelled' where id = v_payment.token_id and status = 'waiting';
  elsif v_payment.appointment_id is not null then
    update public.appointments set status = 'cancelled'
      where id = v_payment.appointment_id and status = 'booked'
      returning slot_id into v_slot_id;
    if v_slot_id is not null then
      update public.appointment_slots set booked = greatest(booked - 1, 0) where id = v_slot_id;
    end if;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, new)
  values (v_payment.org_id, 'payments', v_payment.id, 'refund',
    jsonb_build_object(
      'razorpay_refund_id', p_razorpay_refund_id, 'reason', p_reason, 'initiated_by', p_initiated_by
    ));

  return v_payment;
end;
$$;

revoke execute on function public.record_refund(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, text, text, uuid) to queueless_api;

-- doctor_leave_refund_candidates (0052) redefined -- now also finds captured appointment
-- payments whose doctor has a leave covering the appointment's own slot day (not "today" --
-- an appointment can be for a future date, so the leave check has to match the slot's day, not
-- private.service_day(now())).
create or replace function private.doctor_leave_refund_candidates()
returns table (payment_id uuid, token_id uuid, doctor_id uuid, org_id uuid, razorpay_payment_id text, amount_inr int)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.token_id, t.doctor_id, p.org_id, p.razorpay_payment_id, p.amount_inr
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
  select p.id, null::uuid, a.doctor_id, p.org_id, p.razorpay_payment_id, p.amount_inr
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  join public.appointment_slots sl on sl.id = a.slot_id
  join public.doctors d on d.id = a.doctor_id
  where p.status = 'captured'
    and exists (
      select 1 from public.doctor_leaves dl
      where dl.doctor_id = d.id
        and sl.starts_at::date between dl.from_date and dl.to_date
    );
$$;

revoke execute on function private.doctor_leave_refund_candidates() from public, anon, authenticated;
grant execute on function private.doctor_leave_refund_candidates() to queueless_api;

-- private.housekeeping (0027/0052) redefined -- adds appointment hold release alongside the
-- existing token hold release. Steps 1-5 are byte-for-byte what 0052 shipped (verified via
-- pg_get_functiondef first); step 6 is new.
create or replace function private.housekeeping(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select a.id from public.appointments a
    join public.appointment_slots sl on sl.id = a.slot_id
    where a.status = 'booked' and sl.starts_at + interval '15 minutes' < p_now
    for no key update of a skip locked
  loop
    update public.appointments set status = 'no_show' where id = r.id;
  end loop;

  insert into public.notifications (patient_id, appointment_id, kind, title, body)
  select a.patient_id, a.id, 'appointment_reminder', 'Upcoming appointment',
         'Your appointment is coming up soon'
  from public.appointments a
  join public.appointment_slots sl on sl.id = a.slot_id
  where a.status = 'booked'
    and sl.starts_at between p_now and p_now + interval '30 minutes'
  on conflict do nothing;

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

  for r in
    select id, patient_id from public.tokens
    where status = 'pending_payment' and hold_expires_at < p_now
    for no key update skip locked
  loop
    update public.tokens set status = 'cancelled' where id = r.id;
    if r.patient_id is not null then
      insert into public.notifications (patient_id, token_id, kind, title, body)
      values (r.patient_id, r.id, 'expired', 'Hold released',
              'Your payment window closed, so the spot was released. Book again to retry.')
      on conflict do nothing;
    end if;
  end loop;

  -- Step 6 (new): unpaid appointment holds past hold_expires_at -- release the slot's claimed
  -- capacity too, same as a normal cancel_appointment would, since nothing else ever will for a
  -- hold that never got confirmed.
  for r in
    select id, patient_id, slot_id from public.appointments
    where status = 'pending_payment' and hold_expires_at < p_now
    for no key update skip locked
  loop
    update public.appointments set status = 'cancelled' where id = r.id;
    update public.appointment_slots set booked = greatest(booked - 1, 0) where id = r.slot_id;
    if r.patient_id is not null then
      insert into public.notifications (patient_id, appointment_id, kind, title, body)
      values (r.patient_id, r.id, 'expired', 'Hold released',
              'Your payment window closed, so the slot was released. Book again to retry.')
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

revoke execute on function private.housekeeping(timestamptz) from public, anon, authenticated;
