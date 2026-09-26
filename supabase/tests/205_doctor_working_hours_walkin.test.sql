-- 0075: start_paid_booking rejects a walk-in outside the doctor's working-hours window
-- (60 min before shift start to 30 min before shift end). Schedules are built relative to
-- now() at the org's own timezone, so this test passes no matter what time it's run.
begin;
select plan(7);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000205', 't-205', 'Hours Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('b0000000-0000-0000-0000-000000000205', 'a0000000-0000-0000-0000-000000000205', 'A', 'Svc A', true, 500);

-- Dr. Now: shift covers the current moment (window is [start-60, end-30], now sits inside it).
-- Dr. Early: shift starts 2 hours from now (now is well before the window opens).
-- Dr. Late: shift ended well over an hour ago (now is after the window closed).
-- Dr. Off: only scheduled on a weekday that is NOT today.
-- Dr. NoSchedule: no doctor_schedules rows at all.
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active) values
  ('d0000000-0000-0000-0000-000000000205', 'a0000000-0000-0000-0000-000000000205', 'b0000000-0000-0000-0000-000000000205', 'Dr. Now', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000206', 'a0000000-0000-0000-0000-000000000205', 'b0000000-0000-0000-0000-000000000205', 'Dr. Early', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000207', 'a0000000-0000-0000-0000-000000000205', 'b0000000-0000-0000-0000-000000000205', 'Dr. Late', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000208', 'a0000000-0000-0000-0000-000000000205', 'b0000000-0000-0000-0000-000000000205', 'Dr. Off', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000209', 'a0000000-0000-0000-0000-000000000205', 'b0000000-0000-0000-0000-000000000205', 'Dr. NoSchedule', 'General', 400, true);

insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, max_patients, slot_minutes)
values
  ('d0000000-0000-0000-0000-000000000205', extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint,
    ((now() at time zone 'Asia/Kolkata') - interval '10 minutes')::time,
    ((now() at time zone 'Asia/Kolkata') + interval '40 minutes')::time, 5, 15),
  ('d0000000-0000-0000-0000-000000000206', extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint,
    ((now() at time zone 'Asia/Kolkata') + interval '120 minutes')::time,
    ((now() at time zone 'Asia/Kolkata') + interval '165 minutes')::time, 5, 15),
  ('d0000000-0000-0000-0000-000000000207', extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint,
    ((now() at time zone 'Asia/Kolkata') - interval '180 minutes')::time,
    ((now() at time zone 'Asia/Kolkata') - interval '135 minutes')::time, 5, 15),
  ('d0000000-0000-0000-0000-000000000208', (extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint + 1) % 7,
    '09:00', '17:00', 5, 15);

insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000205', 'p205@queueless.test');
update public.profiles set profile_completed_at = now() where id = 'c0000000-0000-0000-0000-000000000205';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000205', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ select public.start_paid_booking('d0000000-0000-0000-0000-000000000205') $$,
  'now is inside Dr. Now''s window (shift start-60 to end-30) -- the walk-in succeeds'
);

select throws_ok(
  $$ select public.start_paid_booking('d0000000-0000-0000-0000-000000000206') $$,
  'PGRST', null, 'now is before Dr. Early''s window opens -- outside_hours'
);

select throws_ok(
  $$ select public.start_paid_booking('d0000000-0000-0000-0000-000000000207') $$,
  'PGRST', null, 'now is after Dr. Late''s window closed -- outside_hours'
);

select throws_ok(
  $$ select public.start_paid_booking('d0000000-0000-0000-0000-000000000208') $$,
  'PGRST', null, 'Dr. Off has no schedule for today''s weekday -- outside_hours'
);

reset role;

-- next_walkin_window: Dr. Early's next window is later today, derived from their own schedule
-- row (120min-start/165min-end shift -> a 75-minute window: (end-start) + the 30min tail).
select cmp_ok(
  (select window_starts_at from public.next_walkin_window('d0000000-0000-0000-0000-000000000206')),
  '>', now(),
  'Dr. Early''s next walk-in window is reported as still ahead of now'
);
select is(
  (select window_ends_at - window_starts_at from public.next_walkin_window('d0000000-0000-0000-0000-000000000206')),
  interval '75 minutes',
  'the reported window width matches (shift length) + 30 minutes, i.e. -60 open / -30 close'
);

select is_empty(
  $$ select * from public.next_walkin_window('d0000000-0000-0000-0000-000000000209') $$,
  'a doctor with no schedule at all has no next walk-in window within the next two weeks'
);

select * from finish(true);
rollback;
