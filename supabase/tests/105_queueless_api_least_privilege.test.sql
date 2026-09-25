begin;
select plan(25);

-- catalog checks run first, before this test grants queueless_api anything of its own below
select set_eq(
  $$ select format('%I.%I', n.nspname, c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_schema_privilege('queueless_api', n.oid, 'USAGE')
       and has_any_column_privilege('queueless_api', c.oid, 'SELECT') $$,
  array[
    'private.token_notifications', 'public.board_services', 'public.notifications',
    'public.ops_summaries', 'public.profiles', 'public.push_tokens', 'public.services',
    'public.tokens'
  ],
  'queueless_api can read exactly these tables and nothing else'
);
select set_eq(
  $$ select attname::text from pg_attribute
     where attrelid = 'public.notifications'::regclass and attnum > 0 and not attisdropped
       and has_column_privilege('queueless_api', attrelid, attnum, 'UPDATE') $$,
  array['pushed_at'], 'pushed_at is the only notifications column queueless_api can update'
);
-- 0029's per-schema default-privilege revoke is a no-op in Postgres, so every new function needs its own revoke.
-- private.write_audit is the one deliberate door (0036): queueless_api logs its own actions into
-- audit_log through it, with no raw table grant on audit_log itself. analytics.* functions (0033)
-- live in their own schema and are covered separately in tests/110.
select set_eq(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and has_function_privilege('queueless_api', p.oid, 'EXECUTE') $$,
  array['private.write_audit(uuid,text,uuid,text,jsonb,jsonb)'],
  'queueless_api can execute exactly one function in public or private: private.write_audit'
);
select is(has_schema_privilege('queueless_api', 'auth', 'usage'), false, 'queueless_api has no usage on schema auth');
select trigger_is(
  'public', 'notifications', 'notifications_notify_new', 'private', 'notify_new_notification',
  'every notifications insert fires the NOTIFY trigger apps/api listens for'
);

-- postgres holds only ADMIN on queueless_api, not SET; and pgTAP lives in schema extensions.
-- Both granted only so the assertions below can run as queueless_api; rolled back at the end.
grant queueless_api to postgres with set true;
grant usage on schema extensions to queueless_api;

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444105', 't-105', 'API Role Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-000000000105', '44444444-4444-4444-4444-444444444105', 'A', 'API Desk', true, 500);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000105', 'p105patient@queueless.test');

-- a patient's waiting token: one tokens row, plus the board_services row its trigger writes
create temp table tok as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444105', 'bbbbbbbb-0000-0000-0000-000000000105', 'normal',
  '55555555-0000-0000-0000-000000000105', null, null, now(), null
);

insert into public.notifications (id, patient_id, token_id, kind, title, body)
select 'dddddddd-0000-0000-0000-000000000105', '55555555-0000-0000-0000-000000000105', id,
       'called', 'You''re being called', 'Please proceed to Desk 1'
from tok;

insert into public.push_tokens (user_id, expo_token, platform)
values ('55555555-0000-0000-0000-000000000105', 'ExponentPushToken[t105]', 'ios');

set local role queueless_api;

-- real rows, not just a grant: with RLS on and no policy naming this role, a select returns zero rows
select is(
  (select count(*) from public.profiles where id = '55555555-0000-0000-0000-000000000105'),
  1::bigint, 'queueless_api reads profiles'
);
select is(
  (select count(*) from public.services where id = 'bbbbbbbb-0000-0000-0000-000000000105'),
  1::bigint, 'queueless_api reads services (RLS on since 0030)'
);
select is(
  (select count(*) from public.tokens where service_id = 'bbbbbbbb-0000-0000-0000-000000000105'),
  1::bigint, 'queueless_api reads tokens'
);
select is(
  (select count(*) from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-000000000105'),
  1::bigint, 'queueless_api reads board_services (RLS on since 0030)'
);
select is(
  (select count(*) from public.push_tokens where user_id = '55555555-0000-0000-0000-000000000105'),
  1::bigint, 'queueless_api reads push_tokens'
);
select is(
  (select count(*) from public.notifications
     where id = 'dddddddd-0000-0000-0000-000000000105' and pushed_at is null),
  1::bigint, 'queueless_api reads an unpushed notification'
);

select throws_ok(
  $$ select phone from public.profiles $$,
  '42501', null, 'queueless_api cannot read profiles.phone'
);

-- the exact claim apps/api runs before sending a push
update public.notifications set pushed_at = now()
  where id = 'dddddddd-0000-0000-0000-000000000105' and pushed_at is null;
select isnt(
  (select pushed_at from public.notifications where id = 'dddddddd-0000-0000-0000-000000000105'),
  null, 'queueless_api claims a notification: pushed_at is actually set'
);

select throws_ok(
  $$ update public.notifications set body = 'tampered' where id = 'dddddddd-0000-0000-0000-000000000105' $$,
  '42501', null, 'queueless_api cannot update notifications.body'
);
select throws_ok(
  $$ insert into public.notifications (patient_id, token_id, kind, title, body)
     select patient_id, id, 'no_show', 't', 'b' from public.tokens
     where service_id = 'bbbbbbbb-0000-0000-0000-000000000105' $$,
  '42501', null, 'queueless_api cannot insert notifications'
);
select throws_ok(
  $$ delete from public.notifications where id = 'dddddddd-0000-0000-0000-000000000105' $$,
  '42501', null, 'queueless_api cannot delete notifications'
);

-- DeviceNotRegistered cleanup
delete from public.push_tokens where expo_token = 'ExponentPushToken[t105]';

select throws_ok($$ select 1 from public.audit_log $$, '42501', null, 'queueless_api cannot read audit_log');
select throws_ok($$ select 1 from public.appointments $$, '42501', null, 'queueless_api cannot read appointments');
select throws_ok($$ select 1 from public.appointment_slots $$, '42501', null, 'queueless_api cannot read appointment_slots');
select throws_ok($$ select 1 from public.organizations $$, '42501', null, 'queueless_api cannot read organizations');
select throws_ok($$ select 1 from public.counters $$, '42501', null, 'queueless_api cannot read counters');
select throws_ok($$ select 1 from public.counter_services $$, '42501', null, 'queueless_api cannot read counter_services');
select throws_ok($$ select 1 from private.service_days $$, '42501', null, 'queueless_api cannot read private.service_days');

reset role;

select is(
  (select count(*) from public.push_tokens where expo_token = 'ExponentPushToken[t105]'),
  0::bigint, 'queueless_api''s delete actually removed the push token (checked as postgres)'
);

-- pg_notify raises on a payload of 8000+ bytes; that must never fail the insert behind it
select lives_ok(
  $$ insert into public.notifications (patient_id, token_id, kind, title, body)
     select '55555555-0000-0000-0000-000000000105', id, 'no_show', 'No-show', repeat('x', 10000) from tok $$,
  'a 10,000-character body still inserts (the NOTIFY payload is capped)'
);

select * from finish(true);
rollback;
