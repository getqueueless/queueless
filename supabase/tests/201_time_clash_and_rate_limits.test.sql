-- 0069: no double-booking the same time (any doctor/service) -- but the same service/doctor at
-- a DIFFERENT time is fine, any number of times (Yash's exact rule: don't block different
-- timings). Plus DB-level per-patient rate limits (staff/admin exempt).
begin;
select plan(9);

insert into public.organizations (id, slug, name, timezone)
values ('a0000000-0000-0000-0000-000000000201', 't-201', 'Time Clash Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('b0000000-0000-0000-0000-000000000201', 'a0000000-0000-0000-0000-000000000201', 'A', 'Svc A', true, 500),
  ('b0000000-0000-0000-0000-000000000202', 'a0000000-0000-0000-0000-000000000201', 'B', 'Svc B', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active)
values
  ('d0000000-0000-0000-0000-000000000201', 'a0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000201', 'Dr. A', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000202', 'a0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000202', 'Dr. B', 'General', 400, true);
insert into public.appointment_slots (id, service_id, doctor_id, starts_at, capacity, booked)
values
  ('e0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000201', 'd0000000-0000-0000-0000-000000000201', date_trunc('hour', now()) + interval '2 days', 1, 0),
  ('e0000000-0000-0000-0000-000000000202', 'b0000000-0000-0000-0000-000000000202', 'd0000000-0000-0000-0000-000000000202', date_trunc('hour', now()) + interval '2 days', 1, 0),
  ('e0000000-0000-0000-0000-000000000203', 'b0000000-0000-0000-0000-000000000201', 'd0000000-0000-0000-0000-000000000201', now() + interval '3 days', 1, 0);

insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000201', 'p201patient@queueless.test');
update public.profiles set profile_completed_at = now() where id = 'c0000000-0000-0000-0000-000000000201';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000201', 'role', 'authenticated')::text, true);

select isnt_empty(
  format($$ select 1 from public.start_paid_appointment('e0000000-0000-0000-0000-000000000201'::uuid) $$),
  'first hold at time T on service A succeeds'
);

select throws_ok(
  $$ select public.start_paid_appointment('e0000000-0000-0000-0000-000000000202') $$,
  'PGRST', null, 'a second hold at the SAME time T, different doctor/service, is a time clash'
);

select isnt_empty(
  format($$ select 1 from public.start_paid_appointment('e0000000-0000-0000-0000-000000000203'::uuid) $$),
  'a SECOND hold on the SAME service/doctor as the first, at a different time, succeeds -- only the exact same time is blocked'
);

reset role;

-- the unique index itself is the real guarantee -- prove it fires even bypassing the RPC
-- entirely (as postgres, simulating two requests racing past the app-level pre-check;
-- authenticated has no direct insert grant on appointments to test this as itself)
select throws_ok(
  $$ insert into public.appointments (slot_id, service_id, patient_id, status, doctor_id, starts_at)
     select 'e0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000201',
       'c0000000-0000-0000-0000-000000000201', 'booked', 'd0000000-0000-0000-0000-000000000201',
       starts_at from public.appointment_slots where id = 'e0000000-0000-0000-0000-000000000201' $$,
  '23505', null, 'the unique index itself blocks a same-time double-booking, RPC or not'
);

-- rate limiting: the reusable helper directly
select lives_ok(
  $$ select private.check_patient_rate_limit('c0000000-0000-0000-0000-000000000201', 'probe', 3, interval '1 hour') $$,
  'hit 1 of 3 is allowed'
);
select lives_ok(
  $$ select private.check_patient_rate_limit('c0000000-0000-0000-0000-000000000201', 'probe', 3, interval '1 hour') $$,
  'hit 2 of 3 is allowed'
);
select lives_ok(
  $$ select private.check_patient_rate_limit('c0000000-0000-0000-0000-000000000201', 'probe', 3, interval '1 hour') $$,
  'hit 3 of 3 is allowed'
);
select throws_ok(
  $$ select private.check_patient_rate_limit('c0000000-0000-0000-0000-000000000201', 'probe', 3, interval '1 hour') $$,
  'PGRST', null, 'the 4th hit in the window is rate_limited'
);

-- staff/admin are exempt, same action/window, already at the cap for the patient case above
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000202', 'p201staff@queueless.test');
update public.profiles set role = 'staff' where id = 'c0000000-0000-0000-0000-000000000202';
insert into private.rate_hits (patient_id, action)
  select 'c0000000-0000-0000-0000-000000000202', 'probe' from generate_series(1, 5);
select lives_ok(
  $$ select private.check_patient_rate_limit('c0000000-0000-0000-0000-000000000202', 'probe', 3, interval '1 hour') $$,
  'staff/admin are exempt from the rate limit entirely'
);

select * from finish(true);
rollback;
