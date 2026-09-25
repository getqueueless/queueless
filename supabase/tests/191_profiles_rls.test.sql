-- QA #2: public.profiles never had row level security (0045 turns it on). This locks in the
-- intended shape: everyone can read/update their own row; staff/admin can read every profile in
-- their own org (that's what makes /admin/counters' and /admin/staff's own-org staff list work
-- correctly even though those pages query profiles with no org_id filter); nobody can read across
-- orgs; and -- the actual vulnerability this migration closes -- an ordinary authenticated user
-- can no longer PATCH their own `role` or `org_id` column to grant themselves staff/admin access.
begin;
select plan(10);

insert into public.organizations (id, slug, name, timezone)
values
  ('44444444-4444-4444-4444-4444444444d0', 't-191a', 'Profiles Org A', 'UTC'),
  ('44444444-4444-4444-4444-4444444444d1', 't-191b', 'Profiles Org B', 'UTC');

insert into auth.users (id, email) values
  ('55555555-0000-0000-0000-000000000191', 'p191admin@queueless.test'),
  ('55555555-0000-0000-0000-000000000192', 'p191staff@queueless.test'),
  ('55555555-0000-0000-0000-000000000193', 'p191patient@queueless.test'),
  ('55555555-0000-0000-0000-000000000194', 'p191adminb@queueless.test');

update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444d0', full_name = 'Org A Admin'
  where id = '55555555-0000-0000-0000-000000000191';
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-4444444444d0', full_name = 'Org A Staff'
  where id = '55555555-0000-0000-0000-000000000192';
update public.profiles set org_id = '44444444-4444-4444-4444-4444444444d0', full_name = 'Org A Patient'
  where id = '55555555-0000-0000-0000-000000000193';
update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444d1', full_name = 'Org B Admin'
  where id = '55555555-0000-0000-0000-000000000194';

select is(
  has_table_privilege('anon', 'public.profiles', 'SELECT'),
  false, 'anon has no select grant on profiles at all'
);
select is(
  has_table_privilege('anon', 'public.profiles', 'UPDATE'),
  false, 'anon has no update grant on profiles at all'
);

-- a patient can read their own row
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000193', 'role', 'authenticated')::text, true);
select is(
  (select full_name from public.profiles where id = '55555555-0000-0000-0000-000000000193'),
  'Org A Patient', 'a user can read their own profile'
);

-- a patient cannot read another org's admin
select is_empty(
  $$ select 1 from public.profiles where id = '55555555-0000-0000-0000-000000000194' $$,
  'a patient cannot read a profile in a different org'
);

-- a patient CANNOT self-promote to admin by patching their own row's role column
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '55555555-0000-0000-0000-000000000193' $$,
  '42501'
);

-- a patient CAN update their own full_name (a column they're actually granted)
update public.profiles set full_name = 'Renamed Patient' where id = '55555555-0000-0000-0000-000000000193';
select is(
  (select full_name from public.profiles where id = '55555555-0000-0000-0000-000000000193'),
  'Renamed Patient', 'a user can update their own full_name'
);
reset role;

-- org A's own staff member can read a fellow org A profile's full_name (the /admin/counters bug)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000192', 'role', 'authenticated')::text, true);
select is(
  (select full_name from public.profiles where id = '55555555-0000-0000-0000-000000000191'),
  'Org A Admin', 'org A staff can read org A admin''s full_name'
);

-- but not org B's admin
select is_empty(
  $$ select 1 from public.profiles where id = '55555555-0000-0000-0000-000000000194' $$,
  'org A staff cannot read a different org''s profiles'
);
reset role;

-- queueless_api keeps its own pre-existing (narrower, column-level) read access
set local role queueless_api;
select isnt_empty(
  $$ select id, org_id, role from public.profiles where id = '55555555-0000-0000-0000-000000000191' $$,
  'queueless_api can still read the columns it was already granted'
);
reset role;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'row level security is actually turned on for profiles'
);

select * from finish(true);
rollback;
