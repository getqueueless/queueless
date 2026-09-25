-- private.analytics_org()'s queueless_api branch checks session_user, not current_user: SECURITY
-- DEFINER makes current_user the function owner (postgres) for the whole call, so current_user
-- can never distinguish callers. session_user is fixed for the life of a connection and does NOT
-- change with SET ROLE -- so `set local role queueless_api` (the only technique available inside
-- one pgTAP session) can NOT exercise that branch; it only ever proves the admin/JWT path. The
-- queueless_api branch was verified separately with a real direct connection:
--   docker exec -i -e PGPASSWORD="$QUEUELESS_API_DB_PASSWORD" supabase-db \
--     psql -U queueless_api -h localhost -d postgres -c "select * from analytics.tokens_per_day(current_date, current_date)"
-- which returned rows with no error, confirming the single-org fallback actually fires for a real
-- queueless_api connection.
begin;
select plan(20);

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
  has_function_privilege('queueless_api', 'private.analytics_org()', 'EXECUTE'), false,
  'queueless_api cannot call private.analytics_org() directly (only analytics.* functions do, as their owner)'
);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000110', 't-110-a', 'Org A 110', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000110', 't-110-b', 'Org B 110', 'Asia/Kolkata');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000110', 'a0000000-0000-0000-0000-000000000110', 'A', 'Desk A', true, 500),
  ('d0000000-0000-0000-0000-000000000110', 'b0000000-0000-0000-0000-000000000110', 'B', 'Desk B', true, 500);

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

-- One real done token in org A, today (IST), through legitimate mint + state-machine transitions.
create temp table tok110 as select * from private.mint_token(
  'a0000000-0000-0000-0000-000000000110', 'c0000000-0000-0000-0000-000000000110', 'normal',
  null, 'Walkin110', null, now(), null
);
update public.tokens set status = 'called', counter_id = 'e0000000-0000-0000-0000-000000000110',
    called_at = now() + interval '2 minutes'
  where id = (select id from tok110);
update public.tokens set status = 'serving', serving_at = now() + interval '3 minutes'
  where id = (select id from tok110);
update public.tokens set status = 'done', finished_at = now() + interval '6 minutes'
  where id = (select id from tok110);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000110', 'role', 'authenticated')::text,
  true
);

-- Correct results for the org that actually has the token.
select is(
  (select tokens_served from analytics.busiest_counters((now() at time zone 'Asia/Kolkata')::date)
     where counter_id = 'e0000000-0000-0000-0000-000000000110'),
  1::bigint, 'busiest_counters counts the one done token today (IST service day)'
);
select is(
  (select avg_service_secs from analytics.busiest_counters((now() at time zone 'Asia/Kolkata')::date)
     where counter_id = 'e0000000-0000-0000-0000-000000000110'),
  180::numeric, 'busiest_counters computes avg_service_secs from serving_at/finished_at'
);
select is(
  (select avg_wait_minutes from analytics.avg_wait_by_hour(
     'c0000000-0000-0000-0000-000000000110', current_date, current_date + 1)),
  2.0::numeric, 'avg_wait_by_hour computes called_at minus created_at'
);
select is(
  (select avg_actual_wait_secs from analytics.wait_vs_predicted(current_date, current_date + 1)
     where service_id = 'c0000000-0000-0000-0000-000000000110'),
  120::numeric, 'wait_vs_predicted matches avg_wait_by_hour''s underlying wait, in seconds'
);
select is(
  (select no_show_rate from analytics.no_shows_by_service(current_date, current_date + 1)
     where service_id = 'c0000000-0000-0000-0000-000000000110'),
  0::numeric, 'no_shows_by_service: one done token, zero no-shows, rate 0'
);
select is(
  (select tokens_count from analytics.tokens_per_day(current_date, current_date + 1)
     where day = (now() at time zone 'Asia/Kolkata')::date),
  1::bigint, 'tokens_per_day counts the token on its IST service day'
);
select is(
  (select tokens_count from analytics.tokens_per_day(current_date - 5, current_date + 5)
     where day = current_date - 5),
  0::bigint, 'tokens_per_day still zero-fills days with no tokens, not just days with data'
);
select is(
  (select count(*) from analytics.tokens_per_day(current_date - 5, current_date + 5)),
  11::bigint, 'tokens_per_day returns exactly one row per day in the 11-day range'
);
select is(
  (select count(*) from analytics.peak_hours(current_date, current_date + 1)), 24::bigint,
  'peak_hours always returns all 24 hours'
);
select is(
  (select tokens_count from analytics.lane_mix(current_date, current_date + 1) where lane = 'normal'),
  1::bigint, 'lane_mix counts the one normal-lane token'
);
select is(
  (select pct from analytics.lane_mix(current_date, current_date + 1) where lane = 'normal'),
  100.0::numeric, 'lane_mix percentages sum to 100 with only one lane present'
);
select is(
  (select avg_service_secs from analytics.service_time_trend('c0000000-0000-0000-0000-000000000110', 7)),
  180::numeric, 'service_time_trend matches busiest_counters'' avg_service_secs for the same token'
);

-- Org isolation: org A's admin sees nothing from org B, and vice versa -- scope always comes from
-- the caller's own JWT, never a parameter, so there is nothing to pass to see someone else's org.
select is(
  (select count(*) from analytics.no_shows_by_service(current_date - 30, current_date + 30)
     where service_id = 'd0000000-0000-0000-0000-000000000110'),
  0::bigint, 'org A admin sees nothing from org B''s service'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000112', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*) from analytics.no_shows_by_service(current_date - 30, current_date + 30)
     where service_id = 'c0000000-0000-0000-0000-000000000110'),
  0::bigint, 'org B admin symmetrically sees nothing from org A''s service'
);
select is(
  (select tokens_served from analytics.busiest_counters((now() at time zone 'Asia/Kolkata')::date)
     where counter_id = 'e0000000-0000-0000-0000-000000000110'),
  null, 'org B admin gets no row at all for org A''s counter'
);

-- Staff (not admin) is forbidden, same PGRST-shaped error every other RPC in this repo uses.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000111', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select * from analytics.no_shows_by_service(current_date, current_date) $$,
  'PGRST', null, 'staff (not admin) is forbidden from every analytics function'
);
select throws_ok(
  $$ select * from analytics.busiest_counters(current_date) $$,
  'PGRST', null, 'staff (not admin) is forbidden -- busiest_counters too'
);

reset role;
select * from finish(true);
rollback;
