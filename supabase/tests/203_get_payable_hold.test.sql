-- 0071: get_payable_hold is anon's ONLY path to a token/appointment hold -- checks it returns
-- exactly the payment-screen fields, nothing identifying, and nothing at all for a random id or
-- a row in the wrong status.
begin;
select plan(9);

insert into public.organizations (id, slug, name, timezone)
values ('a0000000-0000-0000-0000-000000000203', 't-203', 'Payable Hold Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('b0000000-0000-0000-0000-000000000205', 'a0000000-0000-0000-0000-000000000203', 'A', 'Svc A', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active)
values ('d0000000-0000-0000-0000-000000000204', 'a0000000-0000-0000-0000-000000000203', 'b0000000-0000-0000-0000-000000000205', 'Dr. Payable', 'General', 450, true);
-- 0075's working-hours gate on start_paid_booking needs a schedule covering "now".
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, max_patients, slot_minutes)
values ('d0000000-0000-0000-0000-000000000204', extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint,
  ((now() at time zone 'Asia/Kolkata') - interval '30 minutes')::time,
  ((now() at time zone 'Asia/Kolkata') + interval '90 minutes')::time, 50, 15);
insert into public.appointment_slots (id, service_id, doctor_id, starts_at, capacity, booked)
values ('e0000000-0000-0000-0000-000000000206', 'b0000000-0000-0000-0000-000000000205', 'd0000000-0000-0000-0000-000000000204', now() + interval '2 days', 1, 0);

insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000205', 'p203@queueless.test');
update public.profiles set profile_completed_at = now(), full_name = 'Secret Patient Name'
  where id = 'c0000000-0000-0000-0000-000000000205';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000205', 'role', 'authenticated')::text, true);
select id as tok_id from public.start_paid_booking('d0000000-0000-0000-0000-000000000204'::uuid) \gset
select id as appt_id from public.start_paid_appointment('e0000000-0000-0000-0000-000000000206'::uuid) \gset
reset role;

select ok(
  has_function_privilege('anon', 'public.get_payable_hold(uuid)', 'EXECUTE'),
  'anon can call get_payable_hold'
);

set local role anon;

select is(
  (select kind from public.get_payable_hold(:'tok_id'::uuid)),
  'token', 'anon finds the token hold by id'
);
select is(
  (select fee_inr from public.get_payable_hold(:'tok_id'::uuid)),
  450, 'the token''s fee comes through'
);
select is(
  (select kind from public.get_payable_hold(:'appt_id'::uuid)),
  'appointment', 'anon finds the appointment hold by id too'
);
select is(
  (select doctor_name from public.get_payable_hold(:'appt_id'::uuid)),
  'Dr. Payable', 'the doctor''s name comes through for an appointment hold'
);

select is_empty(
  $$ select 1 from public.get_payable_hold('00000000-0000-0000-0000-000000000000') $$,
  'a random id returns nothing'
);

-- pay the token, confirming it still resolves once waiting, then cancel the appointment hold,
-- confirming it stops resolving once it's neither pending_payment nor booked
reset role;
update public.tokens set status = 'waiting' where id = :'tok_id'::uuid;
set local role anon;
select is(
  (select status from public.get_payable_hold(:'tok_id'::uuid)),
  'waiting', 'a paid (now waiting) token hold still resolves'
);

reset role;
update public.appointments set status = 'cancelled' where id = :'appt_id'::uuid;
set local role anon;
select is_empty(
  format($$ select 1 from public.get_payable_hold(%L) $$, :'appt_id'),
  'a cancelled appointment no longer resolves'
);

-- the whole point: the declared return shape is exactly the safe payment-screen set --
-- structural, not just "this test's query happened not to select a patient column" -- so a
-- future column added to the function's own RETURNS TABLE would fail this immediately.
select is(
  pg_get_function_result('public.get_payable_hold(uuid)'::regprocedure),
  'TABLE(id uuid, kind text, status text, fee_inr integer, hold_expires_at timestamp with time zone, doctor_id uuid, doctor_name text, specialty text, starts_at timestamp with time zone, code text)',
  'get_payable_hold''s return columns are exactly the safe set, nothing identifying'
);

reset role;

select * from finish(true);
rollback;
