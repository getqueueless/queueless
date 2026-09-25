-- Signatures here match apps/api's already-landed, already-tested caller (app/analytics.py +
-- apps/api/scripts/dev_db.py) exactly: org_id is the function's own first positional argument.
-- private.check_analytics_org's queueless_api branch checks session_user, not current_user:
-- SECURITY DEFINER makes current_user the function owner (postgres) for the whole call, so
-- current_user can never distinguish callers. session_user is fixed for the life of a
-- connection and does NOT change with SET ROLE -- so `set local role queueless_api` (the only
-- technique available inside one pgTAP session) can NOT exercise that branch; it only ever
-- proves the admin/JWT path (which itself matters: an authenticated caller passing someone
-- else's org_id must still be rejected). The queueless_api branch was verified separately with
-- a real direct connection:
--   docker exec -i -e PGPASSWORD="$QUEUELESS_API_DB_PASSWORD" supabase-db \
--     psql -U queueless_api -h localhost -d postgres \
--     -c "select * from analytics.no_shows_by_service('<org>'::uuid, (now() at time zone 'Asia/Kolkata')::date)"
-- which returned real rows with no error.
begin;
select plan(16);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon can execute nothing in schema analytics'
);
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace
       and has_function_privilege('public', p.oid, 'EXECUTE') $$,
  'PUBLIC can execute nothing in schema analytics'
);
select is(
  has_function_privilege('queueless_api', 'private.check_analytics_org(uuid)', 'EXECUTE'), false,
  'queueless_api cannot call private.check_analytics_org directly (only analytics.* functions do, as their owner)'
);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000110', 't-110-a', 'Org A 110', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000110', 't-110-b', 'Org B 110', 'Asia/Kolkata');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000110', 'a0000000-0000-0000-0000-000000000110', 'A', 'Desk A', true, 500);

insert into public.counters (id, org_id, name, state) values
  ('e0000000-0000-0000-0000-000000000110', 'a0000000-0000-0000-0000-000000000110', 'C1', 'open');
insert into public.counter_services (counter_id, service_id) values
  ('e0000000-0000-0000-0000-000000000110', 'c0000000-0000-0000-0000-000000000110');

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000110', 'admin110@queueless.test'),
  ('11100000-0000-0000-0000-000000000111', 'staff110@queueless.test'),
  ('11100000-0000-0000-0000-000000000112', 'adminB110@queueless.test');
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000110'
  where id = '11100000-0000-0000-0000-000000000110';
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000110'
  where id = '11100000-0000-0000-0000-000000000111';
update public.profiles set role = 'admin', org_id = 'b0000000-0000-0000-0000-000000000110'
  where id = '11100000-0000-0000-0000-000000000112';

-- One no_show and one done token today, through legitimate mint + state-machine transitions.
create temp table tok110a as select * from private.mint_token(
  'a0000000-0000-0000-0000-000000000110', 'c0000000-0000-0000-0000-000000000110', 'normal',
  null, 'Walkin110a', null, now(), null
);
update public.tokens set status = 'called', counter_id = 'e0000000-0000-0000-0000-000000000110',
    called_at = now() + interval '1 minute'
  where id = (select id from tok110a);
update public.tokens set status = 'no_show' where id = (select id from tok110a);

create temp table tok110b as select * from private.mint_token(
  'a0000000-0000-0000-0000-000000000110', 'c0000000-0000-0000-0000-000000000110', 'normal',
  null, 'Walkin110b', null, now(), null
);
update public.tokens set status = 'called', counter_id = 'e0000000-0000-0000-0000-000000000110',
    called_at = now() + interval '2 minutes'
  where id = (select id from tok110b);
update public.tokens set status = 'serving', serving_at = now() + interval '3 minutes'
  where id = (select id from tok110b);
update public.tokens set status = 'done', finished_at = now() + interval '6 minutes'
  where id = (select id from tok110b);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000110', 'role', 'authenticated')::text,
  true
);

select is(
  (select no_show_count from analytics.no_shows_by_service('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)),
  1::bigint, 'no_shows_by_service counts the one no-show'
);
select is(
  (select total_count from analytics.no_shows_by_service('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)),
  2::bigint, 'no_shows_by_service counts both tokens as total'
);
select is(
  (select served_count from analytics.busiest_counters('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)
     where counter_id = 'e0000000-0000-0000-0000-000000000110'),
  1::bigint, 'busiest_counters counts only the done token, not the no-show'
);
select is(
  (select count(*) from analytics.avg_wait_by_hour('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)),
  1::bigint, 'avg_wait_by_hour returns one row for the hour both calls landed in'
);
select is(
  (select token_count from analytics.tokens_per_day(
     'a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date)),
  2::bigint, 'tokens_per_day counts both tokens'
);
select is(
  (select avg_service_minutes from analytics.service_time_trend(
     'a0000000-0000-0000-0000-000000000110', 'c0000000-0000-0000-0000-000000000110', 7)),
  3.0::numeric, 'service_time_trend averages the one done token''s 3-minute service time'
);
select is(
  (select count(*) from analytics.wait_vs_predicted('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)),
  2::bigint, 'wait_vs_predicted returns one row per called token, not aggregated'
);
select is(
  (select sum(token_count)::bigint from analytics.peak_hours('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)),
  2::bigint, 'peak_hours sums to both tokens across whichever hour(s) they landed in'
);
select is(
  (select token_count from analytics.lane_mix('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date)
     where lane_rank = 1),
  2::bigint, 'lane_mix counts both normal-lane tokens under lane_rank 1'
);

-- Org isolation: an admin cannot pass a different org's id and see its data, even their own.
select throws_ok(
  $$ select * from analytics.no_shows_by_service('b0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date) $$,
  'PGRST', null, 'org A''s admin is forbidden from passing org B''s id'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000112', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select * from analytics.no_shows_by_service('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date) $$,
  'PGRST', null, 'org B''s admin is symmetrically forbidden from passing org A''s id'
);
reset role;

-- Staff (not admin) is forbidden, same PGRST-shaped error every other RPC in this repo uses.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select * from analytics.no_shows_by_service('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date) $$,
  'PGRST', null, 'staff (not admin) is forbidden even for their own org'
);
select throws_ok(
  $$ select * from analytics.busiest_counters('a0000000-0000-0000-0000-000000000110', (now() at time zone 'Asia/Kolkata')::date) $$,
  'PGRST', null, 'staff (not admin) is forbidden -- busiest_counters too'
);

reset role;
select * from finish(true);
rollback;
