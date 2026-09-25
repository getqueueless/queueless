begin;
select plan(16);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000140', 't-140', 'Slots Org 140', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000140', 'a0000000-0000-0000-0000-000000000140', 'A', 'Desk A', true, 500);
insert into public.counters (id, org_id, name, state) values
  ('e0000000-0000-0000-0000-000000000140', 'a0000000-0000-0000-0000-000000000140', 'C1', 'open'),
  ('e0000000-0000-0000-0000-000000000141', 'a0000000-0000-0000-0000-000000000140', 'C2', 'open');
insert into public.counter_services (counter_id, service_id) values
  ('e0000000-0000-0000-0000-000000000140', 'c0000000-0000-0000-0000-000000000140'),
  ('e0000000-0000-0000-0000-000000000141', 'c0000000-0000-0000-0000-000000000140');

insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr) values
  ('f0000000-0000-0000-0000-000000000140', 'a0000000-0000-0000-0000-000000000140', 'c0000000-0000-0000-0000-000000000140', 'Dr. A', 'General', 300),
  ('f0000000-0000-0000-0000-000000000141', 'a0000000-0000-0000-0000-000000000140', 'c0000000-0000-0000-0000-000000000140', 'Dr. B', 'General', 300);

-- Dr. A: every weekday 09:00-09:45, 15-min slots (3 slots/day), with an 09:15-09:30 break --
-- the 09:15 slot must be skipped, 09:00 and 09:30 must survive. All date/time comparisons
-- below go through Asia/Kolkata explicitly, never a bare ::date/::time cast (that implicitly
-- uses the UTC session timezone and silently checks the wrong calendar day/hour -- the same
-- trap documented in supabase/README.md, re-caught live again while writing this test).
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, max_patients, slot_minutes)
select 'f0000000-0000-0000-0000-000000000140', g, '09:00', '09:45', 5, 15 from generate_series(0, 6) g;
insert into public.doctor_breaks (doctor_id, weekday, start_time, end_time)
select 'f0000000-0000-0000-0000-000000000140', g, '09:15', '09:30' from generate_series(0, 6) g;

select private.generate_doctor_slots(
  'f0000000-0000-0000-0000-000000000140', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date + 1
);

select is(
  (select count(*) from public.appointment_slots where doctor_id = 'f0000000-0000-0000-0000-000000000140'
     and (starts_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date),
  2::bigint, 'the break correctly removes exactly one of the three 15-min slots'
);
select is(
  (select count(*) from public.appointment_slots where doctor_id = 'f0000000-0000-0000-0000-000000000140'
     and (starts_at at time zone 'Asia/Kolkata')::time = '09:15'),
  0::bigint, 'the 09:15 slot specifically (inside the break) was never generated'
);

select is(
  private.generate_doctor_slots(
    'f0000000-0000-0000-0000-000000000140', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date
  ),
  0, 're-running slot generation for the same range is idempotent (0 new rows)'
);

-- Leave, tested cleanly on a not-yet-generated day: 0 slots land for it even though the
-- schedule alone would produce some.
insert into public.doctor_leaves (doctor_id, from_date, to_date, reason)
values ('f0000000-0000-0000-0000-000000000140', (now() at time zone 'Asia/Kolkata')::date + 5, (now() at time zone 'Asia/Kolkata')::date + 5, 'Conference');
select private.generate_doctor_slots(
  'f0000000-0000-0000-0000-000000000140', (now() at time zone 'Asia/Kolkata')::date + 5, (now() at time zone 'Asia/Kolkata')::date + 5
);
select is(
  (select count(*) from public.appointment_slots where doctor_id = 'f0000000-0000-0000-0000-000000000140'
     and (starts_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date + 5),
  0::bigint, 'a leave day gets zero slots even though the weekly schedule alone would produce some'
);

select lives_ok(
  $$ insert into public.appointment_slots (service_id, doctor_id, starts_at, capacity)
     values ('c0000000-0000-0000-0000-000000000140', 'f0000000-0000-0000-0000-000000000141',
             (select starts_at from public.appointment_slots where doctor_id = 'f0000000-0000-0000-0000-000000000140' limit 1),
             3) $$,
  'a DIFFERENT doctor of the same service can have a slot at the same start time -- the old unique(service,starts_at) is gone'
);

-- book_appointment carries the slot's doctor onto the appointment; check_in carries it onto the token.
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000140', 'p140@queueless.test');
update public.profiles set profile_completed_at = now() where id = '11100000-0000-0000-0000-000000000140';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000140', 'role', 'authenticated')::text, true);

create temp table appt140 as select * from public.book_appointment(
  (select id from public.appointment_slots where doctor_id = 'f0000000-0000-0000-0000-000000000140' and starts_at > now() + interval '20 minutes' order by starts_at limit 1)
);
select is((select doctor_id from appt140), 'f0000000-0000-0000-0000-000000000140'::uuid,
  'book_appointment stamps the appointment with the slot''s own doctor');
reset role;

-- Force the slot's window open for check_in (mint via mint_token path would skip the RPC's own
-- window math; instead move the slot back so "now" falls inside it).
update public.appointment_slots set starts_at = now() where id = (select slot_id from appt140);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000140', 'role', 'authenticated')::text, true);
create temp table tok140 as select * from public.check_in((select id from appt140));
select is((select doctor_id from tok140), 'f0000000-0000-0000-0000-000000000140'::uuid,
  'check_in carries the appointment''s doctor onto the minted token');
reset role;

-- tok140 (from check_in above) is still 'waiting' for this same service and would otherwise
-- out-prioritize tokA below (it was minted earlier) -- move it out of the way first.
update public.tokens set status = 'cancelled' where id = (select id from tok140);

-- call_next: a counter bound to Dr. A only pulls Dr. A's (or "any doctor") waiting tokens.
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000141', 'staff140@queueless.test');
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000140' where id = '11100000-0000-0000-0000-000000000141';
update public.counters set doctor_id = 'f0000000-0000-0000-0000-000000000141' where id = 'e0000000-0000-0000-0000-000000000141';

create temp table tokA as select * from private.mint_token(
  'a0000000-0000-0000-0000-000000000140', 'c0000000-0000-0000-0000-000000000140', 'normal',
  null, 'ForDrA', null, now(), null, 'f0000000-0000-0000-0000-000000000140'
);
create temp table tokAny as select * from private.mint_token(
  'a0000000-0000-0000-0000-000000000140', 'c0000000-0000-0000-0000-000000000140', 'normal',
  null, 'ForAnyDoctor', null, now() + interval '1 second', null, null
);
grant select on tokA, tokAny to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000141', 'role', 'authenticated')::text, true);

-- e0000000...141 is bound to Dr. B (f...141): it must NOT pull the Dr.-A-bound token first.
create temp table called1 as select * from public.call_next('e0000000-0000-0000-0000-000000000141');
select isnt((select id from called1), (select id from tokA), 'a Dr.-B-bound counter does not pull the Dr.-A-only token');
select is((select id from called1), (select id from tokAny), 'a Dr.-B-bound counter DOES pull an "any doctor" token');

-- e0000000...140 has no doctor binding: it behaves as before and can still reach tok A.
create temp table called2 as select * from public.call_next('e0000000-0000-0000-0000-000000000140');
select is((select id from called2), (select id from tokA), 'an unbound counter pulls the Dr.-A token unchanged from before');

select is(
  (select status from public.tokens where id = (select id from tokA)), 'called'::public.token_status,
  'the Dr.-A token really was called, not skipped'
);
reset role;

-- double-check no double-call happened across the two counters.
select is(
  (select count(*) from public.tokens where status = 'called' and service_id = 'c0000000-0000-0000-0000-000000000140'
     and id in (select id from tokA union select id from tokAny)),
  2::bigint, 'both tokens ended up called exactly once, no overlap between the two counters'
);

-- admin_generate_doctor_slots RPC + org isolation, and public read/no-write on the new tables.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000141', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.admin_generate_doctor_slots('f0000000-0000-0000-0000-000000000140', current_date, current_date) $$,
  'PGRST', null, 'staff (not admin) cannot call admin_generate_doctor_slots'
);
reset role;

insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000142', 'admin140@queueless.test');
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000140' where id = '11100000-0000-0000-0000-000000000142';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000142', 'role', 'authenticated')::text, true);
select cmp_ok(
  (select public.admin_generate_doctor_slots('f0000000-0000-0000-0000-000000000140', current_date + 2, current_date + 2)),
  '>=', 0, 'admin can call admin_generate_doctor_slots for their own doctor'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ insert into public.appointment_slots (service_id, doctor_id, starts_at, capacity)
     values ('c0000000-0000-0000-0000-000000000140', 'f0000000-0000-0000-0000-000000000140', now() + interval '10 days', 1) $$,
  '42501', null, 'authenticated has no direct insert grant on appointment_slots -- RPC-only, like tokens'
);
reset role;

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.proname like '%doctor%'
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon can execute none of the new doctor-aware functions'
);

select * from finish(true);
rollback;
