-- tokens_state_machine (0022) redefined (CREATE OR REPLACE, not editing 0022's file) to allow
-- pending_payment -> waiting (payment confirmed) and pending_payment -> cancelled (hold
-- expired unpaid, or a failed/abandoned attempt swept by housekeeping). Body otherwise
-- unchanged from what's live today -- verified against pg_get_functiondef before writing this,
-- same discipline 0039 used when it redefined mint_token/book_appointment/check_in/call_next.
create or replace function private.tokens_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_id is distinct from old.service_id
     or new.service_day is distinct from old.service_day
     or new.number is distinct from old.number
     or new.lane_rank is distinct from old.lane_rank then
    perform private.fail(409, 'illegal_transition', 'Sort-key columns cannot change');
  end if;

  if new.priority_at is distinct from old.priority_at and new.priority_at > old.priority_at then
    perform private.fail(409, 'illegal_transition', 'priority_at can only move earlier');
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'waiting' and new.status in ('called', 'cancelled'))
      or (old.status = 'called' and new.status in ('serving', 'skipped', 'no_show'))
      or (old.status = 'serving' and new.status = 'done')
      or (old.status in ('no_show', 'skipped') and new.status = 'called' and old.recall_count < 2)
      or (old.status = 'pending_payment' and new.status in ('waiting', 'cancelled'))
    ) then
      perform private.fail(409, 'illegal_transition', 'That ticket cannot change state right now');
    end if;
  end if;

  return new;
end;
$$;

-- Patient-facing: holds a spot for p_doctor_id's online fee, 10 minutes, number minted now.
-- Modeled on issue_token (0010/0037) -- same signed-in/profile/lock/rate-limit/cooldown guards,
-- copied rather than shared, since the one real difference (status + hold_expires_at + fee_inr
-- at birth) can't reuse private.mint_token: that function hardcodes status='waiting' and the
-- state-machine trigger above only fires on UPDATE, not INSERT, so there's no legal way to
-- create a 'waiting' row and immediately downgrade it to 'pending_payment' without either
-- widening mint_token's shared signature (a cross-team function 0039 already extended once) or
-- opening a backwards waiting->pending_payment transition that nothing else should ever take.
-- A duplicated ~15-line insert is the smaller blast radius.
create function public.start_paid_booking(p_doctor_id uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_doctor public.doctors;
  v_service public.services;
  v_existing public.tokens;
  v_count int;
  v_oldest timestamptz;
  v_retry_after int;
  v_next_day timestamptz;
  v_day date;
  v_num int;
  v_code text;
  v_token public.tokens;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.require_complete_profile(v_patient);

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  select * into v_doctor from public.doctors where id = p_doctor_id;
  if v_doctor.id is null or not v_doctor.active then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;
  if v_doctor.fee_inr <= 0 then
    perform private.fail(409, 'not_payable', 'This doctor has no online fee configured');
  end if;

  select * into v_service from public.services where id = v_doctor.service_id;
  if v_service.id is null or not v_service.is_open then
    perform private.fail(409, 'service_closed', 'This service is not open right now');
  end if;

  if exists (
    select 1 from public.doctor_leaves dl
    where dl.doctor_id = p_doctor_id
      and private.service_day(v_service.org_id, now()) between dl.from_date and dl.to_date
  ) then
    perform private.fail(409, 'doctor_on_leave', 'This doctor is on leave today');
  end if;

  select * into v_existing from public.tokens
    where patient_id = v_patient and service_id = v_service.id
      and status in ('pending_payment', 'waiting', 'called', 'serving')
    limit 1;
  if v_existing.id is not null then
    perform private.fail(409, 'already_active', 'You already have a ticket for this service',
      null, json_build_object('token_id', v_existing.id, 'code', v_existing.code)::jsonb);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.tokens
    where patient_id = v_patient and created_at > now() - interval '10 minutes';
  if v_count >= 3 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::int);
    perform private.fail(429, 'rate_limited', 'Too many requests, please slow down', v_retry_after);
  end if;

  select count(*) into v_count
    from public.tokens
    where patient_id = v_patient
      and org_id = v_service.org_id
      and service_day = private.service_day(v_service.org_id, now())
      and status in ('cancelled', 'no_show');
  if v_count >= 3 then
    select ((private.service_day(v_service.org_id, now()) + 1)::timestamp at time zone o.timezone)
      into v_next_day
      from public.organizations o where o.id = v_service.org_id;
    v_retry_after := greatest(1, ceil(extract(epoch from (v_next_day - now())))::int);
    perform private.fail(403, 'cooldown', 'Too many cancellations today, try again tomorrow', v_retry_after);
  end if;

  v_day := private.service_day(v_service.org_id, now());
  insert into private.service_days (service_id, day, last_number)
  values (v_service.id, v_day, 1)
  on conflict (service_id, day) do update set last_number = private.service_days.last_number + 1
  returning last_number into v_num;

  if v_num > v_service.max_tokens_per_day then
    perform private.fail(409, 'queue_full', 'This queue is full for today');
  end if;

  v_code := v_service.code || '-' || lpad(v_num::text, greatest(3, length(v_num::text)), '0');

  insert into public.tokens (
    org_id, service_id, service_day, number, code, lane, lane_rank, priority_at,
    status, patient_id, doctor_id, fee_inr, hold_expires_at
  ) values (
    v_service.org_id, v_service.id, v_day, v_num, v_code, 'normal', 1, now(),
    'pending_payment', v_patient, p_doctor_id, v_doctor.fee_inr, now() + interval '10 minutes'
  )
  returning * into v_token;

  return v_token;
end;
$$;

revoke execute on function public.start_paid_booking(uuid) from public, anon;
grant execute on function public.start_paid_booking(uuid) to authenticated;

-- The four functions below are called only by apps/api over its own direct asyncpg connection
-- (role queueless_api), never through PostgREST -- so, unlike every RPC above, they deliberately
-- do NOT use private.fail(): that helper's PGRST-sqlstate/json convention exists specifically
-- for PostgREST to turn into an HTTP response, and apps/api has no code that parses it (checked
-- app/auth.py, app/routes/*.py -- every existing DB call there is a plain SELECT/UPDATE, this is
-- the first RPC-shaped call from that side). Each returns NULL on any business-rule rejection
-- (not found, wrong state, amount mismatch) and the actual row on success; apps/api turns a NULL
-- into the right HTTP status itself. A hard RAISE is reserved for what should be truly
-- impossible, not for expected rejections like a tampered amount or an idempotent replay.

-- Idempotent per (token, amount): a genuine retry after a failed/expired attempt is a NEW
-- Razorpay order (new razorpay_order_id), so this just inserts another row -- no upsert needed.
create function public.record_order(p_token uuid, p_razorpay_order_id text, p_amount_inr int)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.tokens;
  v_payment public.payments;
begin
  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null or v_token.status <> 'pending_payment' then
    return null;
  end if;
  if v_token.fee_inr is distinct from p_amount_inr then
    return null;
  end if;

  insert into public.payments (org_id, token_id, razorpay_order_id, amount_inr, status)
  values (v_token.org_id, p_token, p_razorpay_order_id, p_amount_inr, 'created')
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke execute on function public.record_order(uuid, text, int) from public, anon, authenticated;
grant execute on function public.record_order(uuid, text, int) to queueless_api;

-- Idempotent (a replayed webhook for an already-captured order returns the same row unchanged,
-- rather than re-running the token transition) and amount-checked (a tampered amount, or one
-- that no longer matches what record_order stored, is rejected -- never captured).
create function public.confirm_payment(p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_inr int)
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
      return null; -- a different payment_id claiming the same order: never overwrite
    end if;
    return v_payment; -- idempotent replay (checkout callback + webhook racing each other)
  end if;

  if v_payment.status <> 'created' then
    return null; -- already failed/refunded: not a legal path back to captured
  end if;

  if v_payment.amount_inr is distinct from p_amount_inr then
    return null; -- tampered amount
  end if;

  update public.payments
    set status = 'captured', razorpay_payment_id = p_razorpay_payment_id, captured_at = now()
    where id = v_payment.id
    returning * into v_payment;

  update public.tokens set status = 'waiting' where id = v_payment.token_id and status = 'pending_payment';
  -- ponytail: if the 10-minute hold already expired (housekeeping already cancelled the
  -- token) before this lands, the token is NOT resurrected here -- the affected-row count above
  -- is silently 0. The payment is still recorded captured (real money moved) so it stays
  -- traceable, just orphaned from a live ticket. Upgrade path: a dedicated 'payment_expired'
  -- token status so this function can tell an expiry-cancel apart from a patient-cancel and
  -- safely revive it -- not built, since Razorpay checkout + webhook normally resolve in well
  -- under 10 minutes and this is a genuine edge, not the common path.

  return v_payment;
end;
$$;

revoke execute on function public.confirm_payment(text, text, int) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, int) to queueless_api;

-- Idempotent: a no-op (returns null) once the order is already captured or refunded, so a late
-- failure webhook can never clobber a real capture. The token itself is left alone -- still
-- pending_payment, so the patient can retry with a fresh order until the hold itself expires.
create function public.mark_payment_failed(p_razorpay_order_id text, p_reason text default null)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  update public.payments
    set status = 'failed', failure_reason = p_reason
    where razorpay_order_id = p_razorpay_order_id and status = 'created'
    returning * into v_payment;
  return v_payment;
end;
$$;

revoke execute on function public.mark_payment_failed(text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_failed(text, text) to queueless_api;

-- p_initiated_by is null for the automatic doctor-leave job, or an admin's profile id for the
-- POST /admin/refunds path -- there is no auth.uid() here (queueless_api is not a signed-in
-- user), so the caller's identity (already checked by apps/api's own require_org_role("admin")
-- for the admin path) is passed straight through, same pattern app/routes/admin.py's
-- retrain_once uses to fold admin_user_id into private.write_audit's payload.
create function public.record_refund(
  p_payment_id uuid, p_razorpay_refund_id text, p_reason text, p_initiated_by uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  update public.payments
    set status = 'refunded', razorpay_refund_id = p_razorpay_refund_id,
        refund_reason = p_reason, refunded_at = now()
    where id = p_payment_id and status = 'captured'
    returning * into v_payment;

  if v_payment.id is not null then
    insert into public.audit_log (org_id, entity, entity_id, action, new)
    values (v_payment.org_id, 'payments', v_payment.id, 'refund',
      jsonb_build_object(
        'razorpay_refund_id', p_razorpay_refund_id, 'reason', p_reason, 'initiated_by', p_initiated_by
      ));
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_refund(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, text, text, uuid) to queueless_api;

-- Read-only candidate list for apps/api's own advisory-locked polling job: every captured
-- payment whose doctor has a leave covering today, not yet refunded (a refunded row's status
-- is no longer 'captured', so it naturally drops off this list -- no separate "already handled"
-- bookkeeping needed). SECURITY DEFINER + a narrow EXECUTE grant rather than raw SELECT grants
-- on doctors/doctor_leaves (queueless_api has neither today) -- same "narrow RPC door" shape as
-- private.write_audit (0036).
create function private.doctor_leave_refund_candidates()
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
    );
$$;

revoke execute on function private.doctor_leave_refund_candidates() from public, anon, authenticated;
grant execute on function private.doctor_leave_refund_candidates() to queueless_api;

-- Admin-only aggregated read over payments_ledger (0051) -- same split cash_report_by_staff/
-- by_doctor use for cash_receipts: the view itself has no grants, this function is the one
-- door, org- and date-scoped, never trusting a client-supplied org_id.
create function public.payments_ledger_report(p_from date, p_to date)
returns table (channel text, amount_inr int, reference text, status text, at timestamptz)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_org uuid;
begin
  if v_admin is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;
  select org_id into v_org from public.profiles where id = v_admin and role = 'admin';
  if v_org is null then
    perform private.fail(403, 'forbidden', 'Admins only');
  end if;

  return query
    select pl.channel, pl.amount_inr, pl.reference, pl.status, pl.at
    from public.payments_ledger pl
    join public.organizations o on o.id = pl.org_id
    where pl.org_id = v_org and (pl.at at time zone o.timezone)::date between p_from and p_to
    order by pl.at desc;
end;
$$;

revoke execute on function public.payments_ledger_report(date, date) from public, anon;
grant execute on function public.payments_ledger_report(date, date) to authenticated;

-- private.housekeeping (0027) redefined (CREATE OR REPLACE, not editing 0027's file) with one
-- added step: an unpaid hold past hold_expires_at is released the same way an unpaid slot
-- always was -- cancelled, notified if the patient has an account. Steps 1-4 are byte-for-byte
-- what's live today (verified against pg_get_functiondef first), same discipline as the
-- redefines above. The existing 'queueless-housekeeping' cron job already calls
-- private.housekeeping() with no args every 30s (0027); CREATE OR REPLACE alone is enough for
-- it to pick up step 5, no new cron.schedule call needed.
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
end;
$$;

revoke execute on function private.housekeeping(timestamptz) from public, anon, authenticated;
