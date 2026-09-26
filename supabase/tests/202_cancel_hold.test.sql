-- 0070: a patient can cancel their own unpaid hold -- neither cancel_appointment (booked only)
-- nor cancel_token (waiting only) covers pending_payment, so this was the missing release.
begin;
select plan(8);

insert into public.organizations (id, slug, name, timezone)
values ('a0000000-0000-0000-0000-000000000202', 't-202', 'Cancel Hold Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('b0000000-0000-0000-0000-000000000203', 'a0000000-0000-0000-0000-000000000202', 'A', 'Svc A', true, 500),
  ('b0000000-0000-0000-0000-000000000204', 'a0000000-0000-0000-0000-000000000202', 'B', 'Svc B', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active)
values ('d0000000-0000-0000-0000-000000000203', 'a0000000-0000-0000-0000-000000000202', 'b0000000-0000-0000-0000-000000000203', 'Dr. A', 'General', 400, true);
-- 0075's working-hours gate on start_paid_booking needs a schedule covering "now" -- centered on
-- the actual test-run time so this never flakes near a day boundary.
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, max_patients, slot_minutes)
values ('d0000000-0000-0000-0000-000000000203', extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint,
  ((now() at time zone 'Asia/Kolkata') - interval '30 minutes')::time,
  ((now() at time zone 'Asia/Kolkata') + interval '90 minutes')::time, 50, 15);
insert into public.appointment_slots (id, service_id, doctor_id, starts_at, capacity, booked)
values ('e0000000-0000-0000-0000-000000000205', 'b0000000-0000-0000-0000-000000000203', 'd0000000-0000-0000-0000-000000000203', now() + interval '2 days', 1, 0);

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000203', 'p202a@queueless.test'),
  ('c0000000-0000-0000-0000-000000000204', 'p202b@queueless.test');
update public.profiles set profile_completed_at = now() where id in (
  'c0000000-0000-0000-0000-000000000203', 'c0000000-0000-0000-0000-000000000204'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000203', 'role', 'authenticated')::text, true);

select id as appt_id from public.start_paid_appointment('e0000000-0000-0000-0000-000000000205'::uuid) \gset

select is(
  (public.cancel_hold(:'appt_id'::uuid))::jsonb ->> 'kind',
  'appointment', 'cancel_hold releases an appointment hold and reports which kind it was'
);
reset role;

select is(
  (select status from public.appointments where id = :'appt_id'::uuid),
  'cancelled'::public.appointment_status, 'the appointment is actually cancelled'
);
select is(
  (select booked from public.appointment_slots where id = 'e0000000-0000-0000-0000-000000000205'),
  0, 'the slot capacity it claimed is released'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000204', 'role', 'authenticated')::text, true);

select id as tok_id from public.start_paid_booking('d0000000-0000-0000-0000-000000000203'::uuid) \gset

select is(
  (public.cancel_hold(:'tok_id'::uuid))::jsonb ->> 'kind',
  'token', 'cancel_hold releases a token hold too'
);
reset role;

select is(
  (select status from public.tokens where id = :'tok_id'::uuid),
  'cancelled'::public.token_status, 'the token is actually cancelled'
);

-- neither a booked appointment nor someone else's hold can be cancelled this way
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000204', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.cancel_hold(%L) $$, :'appt_id'),
  'PGRST', null, 'a different patient cannot cancel someone else''s (already-cancelled) hold'
);
reset role;

select throws_ok(
  $$ select public.cancel_hold('00000000-0000-0000-0000-000000000000') $$,
  'PGRST', null, 'an unknown id 404s'
);

select is(
  has_function_privilege('anon', 'public.cancel_hold(uuid)', 'EXECUTE'),
  false, 'anon cannot call cancel_hold'
);

select * from finish(true);
rollback;
