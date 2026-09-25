begin;
select plan(15);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000120', 't-120', 'Profile Org 120', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000120', 'a0000000-0000-0000-0000-000000000120', 'A', 'Desk A', true, 500);
insert into public.appointment_slots (id, service_id, starts_at, capacity) values
  ('d0000000-0000-0000-0000-000000000120', 'c0000000-0000-0000-0000-000000000120', now() + interval '1 hour', 1);

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000120', 'p120a@queueless.test'),
  ('11100000-0000-0000-0000-000000000121', 'p120b@queueless.test');

-- Not signed in: not_signed_in comes before profile_incomplete.
select throws_ok(
  $$ select public.complete_my_profile('Asha', '+919876543210', '1990-01-01', 'female', 'Patiala') $$,
  'PGRST', null, 'complete_my_profile refuses an anonymous caller'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000120', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.issue_token('c0000000-0000-0000-0000-000000000120') $$,
  'PGRST', null, 'issue_token is blocked before the profile is complete'
);
select throws_ok(
  $$ select public.book_appointment('d0000000-0000-0000-0000-000000000120') $$,
  'PGRST', null, 'book_appointment is blocked before the profile is complete'
);
select throws_ok(
  $$ select public.complete_my_profile('', '+919876543210', '1990-01-01', 'female', 'Patiala') $$,
  'PGRST', null, 'an empty name is rejected'
);
-- a bare 10-digit number is now ACCEPTED (private.normalize_in_phone, see 195's own coverage of
-- that) -- this now checks a genuinely too-short number is still rejected, not that +91 is
-- required.
select throws_ok(
  $$ select public.complete_my_profile('Asha', '987654321', '1990-01-01', 'female', 'Patiala') $$,
  'PGRST', null, 'a 9-digit phone is rejected'
);
select throws_ok(
  $$ select public.complete_my_profile('Asha', '+911876543210', '1990-01-01', 'female', 'Patiala') $$,
  'PGRST', null, 'a phone starting +911 (not a mobile prefix) is rejected'
);
select throws_ok(
  $$ select public.complete_my_profile('Asha', '+919876543210', current_date + 1, 'female', 'Patiala') $$,
  'PGRST', null, 'a future date of birth is rejected'
);

select is(
  (public.complete_my_profile('Asha Kaur', '+919876543210', '1998-04-12', 'female', 'Patiala', 'Model Town')).city,
  'Patiala', 'a valid profile completes and returns the row'
);
select isnt(
  (select profile_completed_at from public.profiles where id = '11100000-0000-0000-0000-000000000120'),
  null, 'profile_completed_at is stamped'
);

-- Now unblocked.
select lives_ok(
  $$ select public.issue_token('c0000000-0000-0000-0000-000000000120') $$,
  'issue_token now works once the profile is complete'
);
reset role;

-- A second patient can't steal the first patient's phone number.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000121', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.complete_my_profile('Raj', '+919876543210', '1985-06-01', 'male', 'Ludhiana') $$,
  'PGRST', null, 'a second patient cannot claim an already-registered phone number'
);
reset role;

-- The bare table constraint backs the RPC up (defense in depth).
select throws_ok(
  $$ update public.profiles set phone = '+919876543210', role = 'patient'
     where id = '11100000-0000-0000-0000-000000000121' $$,
  '23505', null, 'the unique index itself rejects a duplicate patient phone, RPC or not'
);
select throws_ok(
  $$ update public.profiles set phone = '1234567890' where id = '11100000-0000-0000-0000-000000000121' $$,
  '23514', null, 'the check constraint itself rejects a non-E.164 phone, RPC or not'
);

-- Re-calling complete_my_profile edits details without resetting the completion timestamp.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000120', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(distinct profile_completed_at) from (
     select profile_completed_at from public.profiles where id = '11100000-0000-0000-0000-000000000120'
     union all
     select (public.complete_my_profile('Asha Kaur', '+919876543210', '1998-04-12', 'female', 'Chandigarh')).profile_completed_at
  ) x),
  1::bigint, 're-completing edits fields but keeps the original profile_completed_at'
);
select is(
  (select city from public.profiles where id = '11100000-0000-0000-0000-000000000120'),
  'Chandigarh', 're-completing actually updated the editable field'
);

select * from finish(true);
rollback;
