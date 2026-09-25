begin;
select plan(12);

insert into public.organizations (id, slug, name, timezone)
values
  ('44444444-4444-4444-4444-4444444444c0', 't-101a', 'RLS Org A', 'UTC'),
  ('44444444-4444-4444-4444-4444444444c1', 't-101b', 'RLS Org B', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-0000000000a2', '44444444-4444-4444-4444-4444444444c0', 'G', 'General', true, 500);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000f1', 'p101admin@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000f2', 'p101patient@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000f3', 'p101adminb@queueless.test');
update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444c0'
  where id = '55555555-0000-0000-0000-0000000000f1';
update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444c1'
  where id = '55555555-0000-0000-0000-0000000000f3';

-- guarantee a board_services row exists for this test's own fixtures, rather than relying on
-- whatever else happens to be committed in this shared local database
select private.mint_token(
  '44444444-4444-4444-4444-4444444444c0', 'bbbbbbbb-0000-0000-0000-0000000000a2', 'normal', null, 'W1', null, now(), null
);

-- anon can read
set local role anon;
select isnt_empty($$ select 1 from public.organizations $$, 'anon can select organizations');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-0000000000f2', 'role', 'authenticated')::text, true);
select isnt_empty($$ select 1 from public.services $$, 'a signed-in patient can select services');

-- a patient's update is granted but RLS makes it match zero rows (no admin USING clause match)
update public.services set name = 'Hacked' where id = 'bbbbbbbb-0000-0000-0000-0000000000a2';
select is(
  (select name from public.services where id = 'bbbbbbbb-0000-0000-0000-0000000000a2'),
  'General', 'a patient''s update silently touches zero rows, never actually changes the service'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- the org's own admin can update its own service
update public.services set name = 'General OPD' where id = 'bbbbbbbb-0000-0000-0000-0000000000a2';
select is(
  (select name from public.services where id = 'bbbbbbbb-0000-0000-0000-0000000000a2'),
  'General OPD', 'the org''s own admin can update its own service'
);

-- the org's own admin can insert a new counter for their org
insert into public.counters (id, org_id, name, state)
values ('cccccccc-0000-0000-0000-0000000000a2', '44444444-4444-4444-4444-4444444444c0', 'Desk 1', 'closed');
select isnt_empty(
  $$ select 1 from public.counters where id = 'cccccccc-0000-0000-0000-0000000000a2' $$,
  'the org''s own admin can insert a counter for their org'
);

-- deletes are never allowed, even for an admin
select throws_ok(
  $$ delete from public.services where id = 'bbbbbbbb-0000-0000-0000-0000000000a2' $$,
  '42501'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-0000000000f3', 'role', 'authenticated')::text, true);
set local role authenticated;

-- an admin of a DIFFERENT org cannot touch this service
update public.services set name = 'Hijacked' where id = 'bbbbbbbb-0000-0000-0000-0000000000a2';
select is(
  (select name from public.services where id = 'bbbbbbbb-0000-0000-0000-0000000000a2'),
  'General OPD', 'an admin of a different org cannot update this service (RLS silently matches zero rows)'
);

-- an admin of a different org cannot insert a counter into org A
select throws_ok(
  $$ insert into public.counters (org_id, name, state) values ('44444444-4444-4444-4444-4444444444c0', 'Rogue Desk', 'closed') $$,
  '42501'
);

reset role;

set local role anon;
select isnt_empty($$ select 1 from public.board_services $$, 'anon can read board_services');
select isnt_empty($$ select 1 from public.board_counters $$, 'anon can read board_counters');
reset role;

select ok(has_table_privilege('anon', 'public.organizations', 'SELECT'), 'anon has an explicit select grant on organizations');
select is(
  has_table_privilege('anon', 'public.organizations', 'DELETE'),
  false, 'anon has no delete grant on organizations, ever'
);

select * from finish(true);
rollback;
