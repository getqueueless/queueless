-- P0 (QA): a plain 10-digit number (what basically every real user types) must not be rejected.
-- complete_my_profile and staff_register_walkin both normalize through private.normalize_in_phone
-- before validating/storing (0060); this locks in the 3 accepted input shapes and the stored form.
begin;
select plan(9);

select is(private.normalize_in_phone('9876543210'), '+919876543210', 'bare 10 digits, starting 9, normalizes');
select is(private.normalize_in_phone('6876543210'), '+916876543210', 'bare 10 digits, starting 6 (lowest valid), normalizes');
select is(private.normalize_in_phone('919876543210'), '+919876543210', '91-prefixed normalizes');
select is(private.normalize_in_phone('+91 98765 43210'), '+919876543210', '+91-prefixed with spaces normalizes');
select is(private.normalize_in_phone('98765-43210'), '+919876543210', 'dashes are stripped');
select is(private.normalize_in_phone('5876543210'), null, 'a number starting 0-5 is rejected (not a valid Indian mobile prefix)');
select is(private.normalize_in_phone('98765432100'), null, '11 digits is rejected');

insert into public.organizations (id, slug, name, timezone) values
  ('44444444-4444-4444-4444-4444444444f3', 't-195', 'Phone Norm Org', 'UTC');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('bbbbbbbb-0000-0000-0000-0000000000e3', '44444444-4444-4444-4444-4444444444f3', 'G', 'General', true, 500);
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000199', 'p195patient@queueless.test');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000199', 'role', 'authenticated')::text, true);
select public.complete_my_profile('Test Patient', '9123456780', '1995-01-01', 'female', 'Chandigarh');
select is(
  (select phone from public.profiles where id = '55555555-0000-0000-0000-000000000199'),
  '+919123456780', 'complete_my_profile stores the canonical +91 form from a plain 10-digit input'
);
reset role;

update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-4444444444f3' where id = '55555555-0000-0000-0000-000000000199';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000199', 'role', 'authenticated')::text, true);
select public.staff_register_walkin('Walk In', '9988776655', '1988-01-01', 'male', 'Ludhiana', 'bbbbbbbb-0000-0000-0000-0000000000e3');
reset role;

-- walkin_patients has no grant at all for authenticated (0041, deliberate), so read it back as
-- the default (postgres) role, same as every other private-table check in this suite.
select is(
  (select phone from public.walkin_patients where org_id = '44444444-4444-4444-4444-4444444444f3'),
  '+919988776655', 'staff_register_walkin stores the canonical +91 form from a plain 10-digit input'
);

select * from finish(true);
rollback;
