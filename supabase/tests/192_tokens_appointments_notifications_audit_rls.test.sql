-- 0047: tokens/appointments/notifications/audit_log all get real RLS. Same shape each time: a
-- patient sees their own rows, staff/admin see their own org's rows, a different org sees
-- nothing, and apps/api's queueless_api role keeps working (tokens, notifications) via its own
-- using(true) policy matching its pre-existing table grant.
begin;
select plan(14);

insert into public.organizations (id, slug, name, timezone) values
  ('44444444-4444-4444-4444-4444444444e0', 't-192a', 'RLS2 Org A', 'UTC'),
  ('44444444-4444-4444-4444-4444444444e1', 't-192b', 'RLS2 Org B', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('bbbbbbbb-0000-0000-0000-0000000000c1', '44444444-4444-4444-4444-4444444444e0', 'G', 'General', true, 500);

insert into auth.users (id, email) values
  ('55555555-0000-0000-0000-000000000195', 'p192admin@queueless.test'),
  ('55555555-0000-0000-0000-000000000196', 'p192patient@queueless.test'),
  ('55555555-0000-0000-0000-000000000197', 'p192adminb@queueless.test');
update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444e0' where id = '55555555-0000-0000-0000-000000000195';
update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444e1' where id = '55555555-0000-0000-0000-000000000197';

create temp table tok as select * from private.mint_token(
  '44444444-4444-4444-4444-4444444444e0', 'bbbbbbbb-0000-0000-0000-0000000000c1', 'normal',
  '55555555-0000-0000-0000-000000000196', null, null, now(), null
);
grant select on tok to authenticated, queueless_api;
update public.tokens set patient_id = '55555555-0000-0000-0000-000000000196' where id = (select id from tok);

insert into public.notifications (patient_id, token_id, kind, title, body) values
  ('55555555-0000-0000-0000-000000000196', (select id from tok), 'called', 'You''re being called', 'Go to the counter')
on conflict do nothing;

insert into public.audit_log (org_id, entity, entity_id, action) values
  ('44444444-4444-4444-4444-4444444444e0', 'tokens', (select id from tok), 'test_row');

-- tokens: own vs org-staff vs a different org
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000196', 'role', 'authenticated')::text, true);
select is(
  (select status from public.tokens where id = (select id from tok)),
  'waiting'::public.token_status, 'a patient can read their own token'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000195', 'role', 'authenticated')::text, true);
select isnt_empty(
  format($$ select 1 from public.tokens where id = %L $$, (select id from tok)),
  'org A staff/admin can read a token minted in their org, even one they don''t own'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000197', 'role', 'authenticated')::text, true);
select is_empty(
  format($$ select 1 from public.tokens where id = %L $$, (select id from tok)),
  'a different org''s admin cannot read this token'
);
reset role;

-- appointments: staff/admin visibility resolved via services.org_id (appointments has no org_id column)
insert into public.appointment_slots (id, service_id, starts_at, capacity, booked) values
  ('cccccccc-1111-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-0000000000c1', now() + interval '1 day', 1, 0);
insert into public.appointments (slot_id, service_id, patient_id, status, starts_at) values
  ('cccccccc-1111-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-0000000000c1', '55555555-0000-0000-0000-000000000196', 'booked', now() + interval '1 day');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000196', 'role', 'authenticated')::text, true);
select isnt_empty(
  $$ select 1 from public.appointments where patient_id = '55555555-0000-0000-0000-000000000196' $$,
  'a patient can read their own appointment'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000195', 'role', 'authenticated')::text, true);
select isnt_empty(
  $$ select 1 from public.appointments where patient_id = '55555555-0000-0000-0000-000000000196' $$,
  'org A staff/admin can read that appointment via services.org_id'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000197', 'role', 'authenticated')::text, true);
select is_empty(
  $$ select 1 from public.appointments where patient_id = '55555555-0000-0000-0000-000000000196' $$,
  'a different org''s admin cannot read this appointment'
);
reset role;

-- notifications: own row, org-staff via the linked token, update scoped to own row
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000196', 'role', 'authenticated')::text, true);
select isnt_empty(
  $$ select 1 from public.notifications where patient_id = '55555555-0000-0000-0000-000000000196' $$,
  'a patient can read their own notification'
);
-- the mint_token above also auto-fires an 'almost_turn' notification (top-3 waiting, 0024's
-- trigger) alongside the 'called' one inserted above -- scope to 'called' so this only ever
-- touches the one row this test owns.
update public.notifications set read_at = now()
  where patient_id = '55555555-0000-0000-0000-000000000196' and kind = 'called';
select ok(
  (select read_at from public.notifications where patient_id = '55555555-0000-0000-0000-000000000196' and kind = 'called') is not null,
  'a patient can mark their own notification read'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000195', 'role', 'authenticated')::text, true);
select isnt_empty(
  $$ select 1 from public.notifications where patient_id = '55555555-0000-0000-0000-000000000196' $$,
  'org A staff can read that notification via its token''s org'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000197', 'role', 'authenticated')::text, true);
select is_empty(
  $$ select 1 from public.notifications where patient_id = '55555555-0000-0000-0000-000000000196' $$,
  'a different org''s admin cannot read this notification'
);
reset role;

-- audit_log: staff/admin of the row's own org only
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000195', 'role', 'authenticated')::text, true);
select isnt_empty(
  $$ select 1 from public.audit_log where entity = 'tokens' and action = 'test_row' $$,
  'org A staff/admin can read their org''s audit_log rows'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000197', 'role', 'authenticated')::text, true);
select is_empty(
  $$ select 1 from public.audit_log where entity = 'tokens' and action = 'test_row' $$,
  'a different org''s admin cannot read this audit_log row'
);
reset role;

-- queueless_api keeps working against tokens and notifications. Postgres won't let this test
-- SET ROLE into queueless_api (a real login role, not a group role postgres is a member of --
-- same reason 105_queueless_api_least_privilege.test.sql only ever checks catalog privileges,
-- never actually runs as it), so this checks the same thing 0045/0047's other _api_read policies
-- are checked by: the grant it already had (0018/0031) is matched by a using(true) policy, not
-- silently reduced to zero rows now that RLS is on.
select ok(
  has_table_privilege('queueless_api', 'public.tokens', 'SELECT')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tokens'
                and roles = '{queueless_api}' and qual = 'true'),
  'queueless_api''s existing tokens grant is matched by a using(true) policy'
);
select ok(
  has_table_privilege('queueless_api', 'public.notifications', 'SELECT')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications'
                and roles = '{queueless_api}' and cmd = 'SELECT' and qual = 'true'),
  'queueless_api''s existing notifications grant is matched by a using(true) policy'
);

select * from finish(true);
rollback;
