begin;
select plan(21);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000130', 't-130-a', 'Doctors Org A', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000130', 't-130-b', 'Doctors Org B', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000130', 'a0000000-0000-0000-0000-000000000130', 'A', 'Desk A', true, 500),
  ('c0000000-0000-0000-0000-000000000131', 'b0000000-0000-0000-0000-000000000130', 'B', 'Desk B', true, 500);

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000130', 'admin130@queueless.test'),
  ('11100000-0000-0000-0000-000000000131', 'staff130@queueless.test'),
  ('11100000-0000-0000-0000-000000000132', 'adminB130@queueless.test');
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000130'
  where id = '11100000-0000-0000-0000-000000000130';
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000130'
  where id = '11100000-0000-0000-0000-000000000131';
update public.profiles set role = 'admin', org_id = 'b0000000-0000-0000-0000-000000000130'
  where id = '11100000-0000-0000-0000-000000000132';

-- anon can read, cannot write.
select is(
  (select count(*) from public.doctors where org_id = 'a0000000-0000-0000-0000-000000000130'),
  0::bigint, 'sanity: no doctors yet'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000130', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.admin_upsert_doctor(null, 'c0000000-0000-0000-0000-000000000131', 'Dr X', 'General') $$,
  'PGRST', null, 'an admin cannot create a doctor for a service outside their own org'
);

create temp table doc130 as
  select * from public.admin_upsert_doctor(
    null, 'c0000000-0000-0000-0000-000000000130', 'Dr. Simran Kaur', 'General Medicine',
    'MBBS, MD', 'Room 4', null, 300, true
  );
select is((select name from doc130), 'Dr. Simran Kaur', 'admin_upsert_doctor creates a doctor');
select is((select org_id from doc130), 'a0000000-0000-0000-0000-000000000130'::uuid,
  'the doctor is stamped with the service''s own org, not a caller-supplied one');

-- a status row was seeded automatically, and reads back as available with no explicit call.
select is(
  (select status from public.doctor_status_today where doctor_id = (select id from doc130)),
  'available', 'a freshly created doctor defaults to available with zero explicit status calls'
);

reset role;

-- staff (not just admin) can set doctor status, per spec.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000131', 'role', 'authenticated')::text,
  true
);
select is(
  (public.set_doctor_status((select id from doc130), 'running_late', 20)).status,
  'running_late', 'staff can set a doctor running_late with a minute count'
);
select throws_ok(
  $$ select public.set_doctor_status(
       (select id from doc130), 'running_late', null
     ) $$,
  'PGRST', null, 'running_late requires a positive minute count'
);
select is(
  (select late_minutes from public.doctor_status_today where doctor_id = (select id from doc130)),
  20, 'doctor_status_today reflects today''s explicit status'
);
reset role;

-- Stale day: back-date the stored row to yesterday and confirm the view falls back to available.
update public.doctor_status set day = (select day from public.doctor_status where doctor_id = (select id from doc130)) - 1
  where doctor_id = (select id from doc130);
select is(
  (select status from public.doctor_status_today where doctor_id = (select id from doc130)),
  'available', 'a stale (yesterday''s) status row reads back as available today, no manual reset needed'
);
select is(
  (select late_minutes from public.doctor_status_today where doctor_id = (select id from doc130)),
  null, 'and late_minutes is hidden along with it'
);

-- Multiple shifts per day, schedules + breaks + leaves.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000130', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  $$ select public.admin_upsert_doctor_schedule(null, (select id from doc130), 1::smallint, '09:00'::time, '13:00'::time, 20, 15) $$,
  'a morning shift can be created'
);
select lives_ok(
  $$ select public.admin_upsert_doctor_schedule(null, (select id from doc130), 1::smallint, '17:00'::time, '20:00'::time, 15, 15) $$,
  'a second (evening) shift on the SAME weekday can be created -- no unique(doctor,weekday) blocks it'
);
select is(
  (select count(*) from public.doctor_schedules where doctor_id = (select id from doc130) and weekday = 1),
  2::bigint, 'both shifts are stored'
);
select throws_ok(
  $$ select public.admin_upsert_doctor_schedule(null, (select id from doc130), 1::smallint, '13:00'::time, '09:00'::time, 20, 15) $$,
  '23514', null, 'end_time before start_time is rejected by the check constraint'
);

select lives_ok(
  $$ select public.admin_upsert_doctor_break(null, (select id from doc130), 1::smallint, '11:00'::time, '11:30'::time) $$,
  'a break can be created'
);
select lives_ok(
  $$ select public.admin_upsert_doctor_leave(null, (select id from doc130), current_date, current_date, 'Personal') $$,
  'a leave day can be created'
);

-- org isolation on the admin CRUD path.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000132', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.admin_upsert_doctor_schedule(null, (select id from doc130), 2::smallint, '09:00'::time, '12:00'::time, 10, 15) $$,
  'PGRST', null, 'org B''s admin cannot add a schedule to org A''s doctor'
);
select throws_ok(
  $$ select public.set_doctor_status((select id from doc130), 'off') $$,
  'PGRST', null, 'org B''s admin cannot set org A''s doctor status either'
);
reset role;

-- delete paths.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000130', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  $$ select public.admin_delete_doctor_break(
       (select id from public.doctor_breaks where doctor_id = (select id from doc130) limit 1)
     ) $$,
  'admin can delete their own doctor''s break'
);
select is(
  (select count(*) from public.doctor_breaks where doctor_id = (select id from doc130)),
  0::bigint, 'the break is actually gone'
);
reset role;

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and p.proname like '%doctor%' $$,
  'anon can execute none of the doctor RPCs'
);

select * from finish(true);
rollback;
