begin;
select plan(44);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000180', 't-180-a', 'Payments Org A', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000180', 't-180-b', 'Payments Org B', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000180', 'a0000000-0000-0000-0000-000000000180', 'P', 'Paid Clinic', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active) values
  ('f0000000-0000-0000-0000-000000000180', 'a0000000-0000-0000-0000-000000000180', 'c0000000-0000-0000-0000-000000000180', 'Dr. Paid', 'Gen', 500, true),
  ('f0000000-0000-0000-0000-000000000181', 'a0000000-0000-0000-0000-000000000180', 'c0000000-0000-0000-0000-000000000180', 'Dr. Free', 'Gen', 0, true),
  ('f0000000-0000-0000-0000-000000000182', 'a0000000-0000-0000-0000-000000000180', 'c0000000-0000-0000-0000-000000000180', 'Dr. Away', 'Gen', 500, true),
  ('f0000000-0000-0000-0000-000000000183', 'a0000000-0000-0000-0000-000000000180', 'c0000000-0000-0000-0000-000000000180', 'Dr. Hold', 'Gen', 500, true);
-- from_date/to_date must match the org's own service_day (Asia/Kolkata), not bare UTC
-- current_date -- start_paid_booking checks private.service_day(org, now()), and the two can
-- disagree on which calendar date "today" is for several hours around UTC midnight.
insert into public.doctor_leaves (doctor_id, from_date, to_date)
select 'f0000000-0000-0000-0000-000000000182', private.service_day('a0000000-0000-0000-0000-000000000180', now()), private.service_day('a0000000-0000-0000-0000-000000000180', now());

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000180', 'p180@queueless.test'),
  ('11100000-0000-0000-0000-000000000181', 'admin180@queueless.test'),
  ('11100000-0000-0000-0000-000000000182', 'adminB180@queueless.test');
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000180' where id = '11100000-0000-0000-0000-000000000181';
update public.profiles set role = 'admin', org_id = 'b0000000-0000-0000-0000-000000000180' where id = '11100000-0000-0000-0000-000000000182';

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
       and p.proname in ('start_paid_booking', 'record_order', 'confirm_payment', 'mark_payment_failed', 'record_refund') $$,
  'anon can execute none of the payment functions'
);
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proname in ('record_order', 'confirm_payment', 'mark_payment_failed', 'record_refund') $$,
  'a signed-in patient cannot execute any of the queueless_api-only payment functions'
);
select is(relrowsecurity, true, 'payments has RLS on') from pg_class where oid = 'public.payments'::regclass;
select is_empty(
  $$ select grantee::text from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'payments' and grantee = 'anon' $$,
  'payments has no direct table grant to anon'
);
-- authenticated DOES get select (0053) -- gated by the payments_admin_read RLS policy tested
-- further down, not by the grant alone.
select is(
  (select count(*)::int from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'payments' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1, 'authenticated has exactly a select grant on payments, RLS-gated'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000180', 'role', 'authenticated')::text, true);
select public.complete_my_profile('Payer Patient', '+919876501800', '1992-02-02', 'other', 'Amritsar');

select throws_ok(
  $$ select public.start_paid_booking('f0000000-0000-0000-0000-000000000181') $$,
  'PGRST', null, 'a doctor with no online fee cannot be booked-and-paid'
);
select throws_ok(
  $$ select public.start_paid_booking('f0000000-0000-0000-0000-000000000182') $$,
  'PGRST', null, 'a doctor on leave today cannot be booked-and-paid'
);

create temp table hold180 as select * from public.start_paid_booking('f0000000-0000-0000-0000-000000000180');
grant select on hold180 to public;
select is((select status from hold180), 'pending_payment'::public.token_status, 'start_paid_booking mints a pending_payment token');
select is((select fee_inr from hold180), 500, 'the fee is copied from the doctor, not client-suppliable');
select ok((select hold_expires_at from hold180) between now() + interval '9 minutes' and now() + interval '10 minutes', 'the hold expires about 10 minutes out');

select throws_ok(
  $$ select public.start_paid_booking('f0000000-0000-0000-0000-000000000180') $$,
  'PGRST', null, 'a second paid booking for the same service while one is pending_payment is already_active'
);
reset role;

-- apps/api's own DB role from here -- record_order/confirm_payment/mark_payment_failed/
-- record_refund/doctor_leave_refund_candidates are called directly over asyncpg, never through
-- PostgREST, so they return null on rejection instead of raising private.fail (see 0052's
-- header comment) -- asserted with `ok(... is null, ...)` (pgTAP's `is` has no
-- payments-vs-null overload for a whole composite row), not throws_ok.
-- postgres holds only ADMIN on queueless_api, not SET; and pgTAP itself lives in schema
-- extensions, which queueless_api has no USAGE on by default -- without it, pgTAP's own
-- ok()/is() are invisible to queueless_api's own overload resolution ("does not exist", not a
-- permission error). Same two grants test 105 uses, rolled back at the end same as there.
grant queueless_api to postgres with set true;
grant usage on schema extensions to queueless_api;
set local role queueless_api;

select ok(
  (select public.record_order((select id from hold180), null, 'order_bad', 499)) is null,
  'record_order rejects an amount that does not match the token''s fee'
);
create temp table ord180 as select * from public.record_order((select id from hold180), null, 'order_180', 500);
grant select on ord180 to public;
select is((select status from ord180), 'created'::public.payment_status, 'record_order creates a payments row in created status');

select ok(
  (select public.confirm_payment('order_180', 'pay_180', 499)) is null,
  'confirm_payment rejects a tampered amount -- the order stays uncaptured'
);
create temp table cap180 as select * from public.confirm_payment('order_180', 'pay_180', 500);
grant select on cap180 to public;
select is((select status from cap180), 'captured'::public.payment_status, 'confirm_payment captures on a matching amount');
select is((select status from public.tokens where id = (select id from hold180)), 'waiting'::public.token_status, 'the held token becomes a real waiting ticket once paid');

select is(
  (select status from public.confirm_payment('order_180', 'pay_180', 500)),
  'captured'::public.payment_status, 'a replayed confirm (checkout callback racing the webhook) is idempotent, not an error'
);
select is(
  (select count(*)::int from public.payments where razorpay_order_id = 'order_180'),
  1, 'the replay did not insert a second payments row'
);

select ok(
  (select public.mark_payment_failed('order_180', 'late webhook')) is null,
  'a late failure webhook cannot clobber an already-captured payment'
);
select is((select status from public.payments where razorpay_order_id = 'order_180'), 'captured'::public.payment_status, 'still captured after the no-op failure attempt');

reset role;

-- doctor-leave auto-refund: put Dr. Paid on leave today, confirm the candidate appears, refund it.
insert into public.doctor_leaves (doctor_id, from_date, to_date)
select 'f0000000-0000-0000-0000-000000000180', private.service_day('a0000000-0000-0000-0000-000000000180', now()), private.service_day('a0000000-0000-0000-0000-000000000180', now());
grant queueless_api to postgres with set true;
set local role queueless_api;
select is(
  (select count(*)::int from private.doctor_leave_refund_candidates() where payment_id = (select id from cap180)),
  1, 'the captured payment shows up as a doctor-leave refund candidate'
);
create temp table refund180 as select * from public.record_refund((select id from cap180), 'rfnd_180', 'doctor on leave', null);
grant select on refund180 to public;
select is((select status from refund180), 'refunded'::public.payment_status, 'record_refund marks the payment refunded');
select is((select initiated_by from refund180), null::uuid, 'a null p_initiated_by (the automatic doctor-leave job) is stored as null, not an admin id');
select is(
  (select count(*)::int from private.doctor_leave_refund_candidates() where payment_id = (select id from cap180)),
  0, 'a refunded payment drops off the candidate list on its own'
);
select ok(
  (select public.record_refund((select id from cap180), 'rfnd_again', 'retry', null)) is null,
  'a payment already refunded cannot be refunded again'
);
reset role;

-- housekeeping releases an unpaid hold once it expires, never one still inside its window.
-- A fresh doctor (f183, never touched above) -- the doctor-leave refund above already cancelled
-- hold180's token (record_refund releases token->cancelled), freeing the service slot, so no
-- explicit cancel_token is needed here.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000180', 'role', 'authenticated')::text, true);
create temp table hold180b as select * from public.start_paid_booking('f0000000-0000-0000-0000-000000000183');
grant select on hold180b to public;
reset role;

update public.tokens set hold_expires_at = now() - interval '1 minute' where id = (select id from hold180b);
select private.housekeeping();
select is((select status from public.tokens where id = (select id from hold180b)), 'cancelled'::public.token_status, 'an unpaid hold past hold_expires_at is released by housekeeping');

-- org isolation on the admin ledger report
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000182', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.payments_ledger_report(current_date - 1, current_date + 1)), 0, 'org B''s admin sees none of org A''s payments');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000181', 'role', 'authenticated')::text, true);
select ok(
  exists(select 1 from public.payments_ledger_report(current_date - 1, current_date + 1) where reference = 'pay_180' and status = 'refunded'),
  'org A''s own admin sees the (now refunded) online payment in the unified ledger'
);
reset role;

-- 0053: an admin can now read their own org's payments directly (RLS), not just through
-- payments_ledger_report -- same org isolation, checked against the raw table this time.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000181', 'role', 'authenticated')::text, true);
select ok(
  exists(select 1 from public.payments where razorpay_order_id = 'order_180'),
  'org A''s own admin can read the payments row directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000182', 'role', 'authenticated')::text, true);
select is(
  (select count(*)::int from public.payments where razorpay_order_id = 'order_180'),
  0, 'org B''s admin cannot read org A''s payments row directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000180', 'role', 'authenticated')::text, true);
select is(
  (select count(*)::int from public.payments where razorpay_order_id = 'order_180'),
  0, 'the patient who paid cannot read the payments row directly -- admin-only, not owner-read'
);
reset role;

-- ---- paid appointments (0055-0057) -----------------------------------

insert into public.appointment_slots (id, service_id, doctor_id, starts_at, capacity, booked) values
  ('d0000000-0000-0000-0000-000000000180', 'c0000000-0000-0000-0000-000000000180', 'f0000000-0000-0000-0000-000000000182', now() + interval '2 hours', 1, 0),
  ('d0000000-0000-0000-0000-000000000181', 'c0000000-0000-0000-0000-000000000180', 'f0000000-0000-0000-0000-000000000183', now() + interval '3 hours', 1, 0),
  ('d0000000-0000-0000-0000-000000000182', 'c0000000-0000-0000-0000-000000000180', 'f0000000-0000-0000-0000-000000000183', now() + interval '4 hours', 1, 0),
  ('d0000000-0000-0000-0000-000000000183', 'c0000000-0000-0000-0000-000000000180', 'f0000000-0000-0000-0000-000000000183', now() + interval '5 days', 1, 0);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000180', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.start_paid_appointment('d0000000-0000-0000-0000-000000000180') $$,
  'PGRST', null, 'a slot for a doctor on leave today cannot be booked-and-paid'
);

create temp table apptHold180 as select * from public.start_paid_appointment('d0000000-0000-0000-0000-000000000181');
grant select on apptHold180 to public;
select is((select status from apptHold180), 'pending_payment'::public.appointment_status, 'start_paid_appointment holds the appointment as pending_payment');
select is((select fee_inr from apptHold180), 500, 'the appointment fee is copied from the slot''s doctor');
select is((select booked from public.appointment_slots where id = 'd0000000-0000-0000-0000-000000000181'), 1, 'the slot''s capacity is claimed immediately, before payment');
reset role;

grant queueless_api to postgres with set true;
set local role queueless_api;
create temp table apptOrd180 as select * from public.record_order(null, (select id from apptHold180), 'order_appt180', 500);
grant select on apptOrd180 to public;
select is((select status from apptOrd180), 'created'::public.payment_status, 'record_order works for an appointment target too');

create temp table apptCap180 as select * from public.confirm_payment('order_appt180', 'pay_appt180', 500);
grant select on apptCap180 to public;
select is((select status from apptCap180), 'captured'::public.payment_status, 'confirm_payment captures an appointment-linked order');
select is(
  (select status from public.appointments where id = (select id from apptHold180)),
  'booked'::public.appointment_status, 'the held appointment becomes a real booking once paid'
);

create temp table apptRefund180 as select * from public.record_refund((select id from apptCap180), 'rfnd_appt180', 'testing appointment refund release', null);
grant select on apptRefund180 to public;
select is((select status from apptRefund180), 'refunded'::public.payment_status, 'record_refund refunds an appointment-linked payment');
select is(
  (select status from public.appointments where id = (select id from apptHold180)),
  'cancelled'::public.appointment_status, 'refunding an appointment payment cancels the booking'
);
select is(
  (select booked from public.appointment_slots where id = 'd0000000-0000-0000-0000-000000000181'),
  0, 'refunding an appointment payment releases the slot''s claimed capacity'
);
reset role;

-- doctor-leave candidate list covers appointments too -- the leave range is derived from the
-- slot's own starts_at::date so this can't drift on a UTC/IST boundary the way private.service_day
-- vs a bare ::date cast could (same subtlety already hit once for the token-side fixture above).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000180', 'role', 'authenticated')::text, true);
create temp table apptHold180b as select * from public.start_paid_appointment('d0000000-0000-0000-0000-000000000182');
grant select on apptHold180b to public;
reset role;

grant queueless_api to postgres with set true;
set local role queueless_api;
create temp table apptOrd180b as select * from public.record_order(null, (select id from apptHold180b), 'order_appt180b', 500);
create temp table apptCap180b as select * from public.confirm_payment('order_appt180b', 'pay_appt180b', 500);
grant select on apptCap180b to public;
reset role;

insert into public.doctor_leaves (doctor_id, from_date, to_date)
select 'f0000000-0000-0000-0000-000000000183', starts_at::date, starts_at::date from public.appointment_slots where id = 'd0000000-0000-0000-0000-000000000182';

grant queueless_api to postgres with set true;
set local role queueless_api;
select is(
  (select count(*)::int from private.doctor_leave_refund_candidates() where payment_id = (select id from apptCap180b)),
  1, 'a captured appointment payment shows up as a doctor-leave refund candidate too'
);
reset role;

-- housekeeping releases an unpaid appointment hold past its window, freeing the slot.
-- Slot 183, not 182 -- 182's own calendar date is now covered by the doctor-leave insert just
-- above, which would make a second start_paid_appointment on it fail as doctor_on_leave.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000180', 'role', 'authenticated')::text, true);
select public.cancel_appointment((select id from apptHold180b)); -- clear the now-'booked' one first (same service, one-active-per-service)
create temp table apptHoldExpiring as select * from public.start_paid_appointment('d0000000-0000-0000-0000-000000000183');
grant select on apptHoldExpiring to public;
reset role;

update public.appointments set hold_expires_at = now() - interval '1 minute' where id = (select id from apptHoldExpiring);
select private.housekeeping();
select is(
  (select status from public.appointments where id = (select id from apptHoldExpiring)),
  'cancelled'::public.appointment_status, 'an unpaid appointment hold past hold_expires_at is released by housekeeping'
);
select is(
  (select booked from public.appointment_slots where id = 'd0000000-0000-0000-0000-000000000183'),
  0, 'housekeeping releases the slot''s claimed capacity along with the cancelled hold'
);

select * from finish(true);
rollback;
