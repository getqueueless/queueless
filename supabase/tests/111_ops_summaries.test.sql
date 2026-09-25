-- Schema matches apps/api's already-landed, already-tested caller (app/summary.py,
-- app/routes/ai.py's admin_summary_get) exactly: report/ai_generated/aggregates, unique
-- (org_id, day) with no lang column -- translation happens live at read time, not per stored
-- language. Discovered mid-task via `git pull --rebase`.
begin;
select plan(11);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000111', 't-111-a', 'Org A 111', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000111', 't-111-b', 'Org B 111', 'Asia/Kolkata');

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000110', 'admin111@queueless.test'),
  ('11100000-0000-0000-0000-000000000111', 'staff111@queueless.test'),
  ('11100000-0000-0000-0000-000000000112', 'adminB111@queueless.test');
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000111'
  where id = '11100000-0000-0000-0000-000000000110';
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000111'
  where id = '11100000-0000-0000-0000-000000000111';
update public.profiles set role = 'admin', org_id = 'b0000000-0000-0000-0000-000000000111'
  where id = '11100000-0000-0000-0000-000000000112';

select is(relrowsecurity, true, 'ops_summaries has RLS on')
  from pg_class where oid = 'public.ops_summaries'::regclass;

grant queueless_api to postgres with set true;
grant usage on schema extensions to queueless_api;
set local role queueless_api;
select lives_ok(
  $$ insert into public.ops_summaries (org_id, day, report, ai_generated, aggregates)
     values ('a0000000-0000-0000-0000-000000000111', current_date, 'Quiet day.', true, '{}'::jsonb)
     on conflict (org_id, day) do update set
       report = excluded.report, ai_generated = excluded.ai_generated, aggregates = excluded.aggregates $$,
  'queueless_api can insert a summary via the real upsert statement'
);
select lives_ok(
  $$ insert into public.ops_summaries (org_id, day, report, ai_generated, aggregates)
     values ('a0000000-0000-0000-0000-000000000111', current_date, 'Busier than expected.', true, '{}'::jsonb)
     on conflict (org_id, day) do update set
       report = excluded.report, ai_generated = excluded.ai_generated, aggregates = excluded.aggregates $$,
  'a same-day rerun upserts in place -- needs insert AND update, not insert-only'
);
select is(
  (select count(*) from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111'),
  1::bigint, 'the upsert replaced the row rather than creating a second one'
);
select is(
  (select report from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111'),
  'Busier than expected.', 'the replaced row has the second run''s report'
);
select throws_ok(
  $$ delete from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111' $$,
  '42501', null, 'queueless_api cannot delete ops_summaries -- select/insert/update only'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000110', 'role', 'authenticated')::text,
  true
);
select is(
  (select report from public.ops_summaries
     where org_id = 'a0000000-0000-0000-0000-000000000111' and day = current_date),
  'Busier than expected.', 'org A admin reads their own org''s summary'
);
select throws_ok(
  $$ insert into public.ops_summaries (org_id, day, report, ai_generated, aggregates)
     values ('a0000000-0000-0000-0000-000000000111', current_date + 1, 'x', true, '{}'::jsonb) $$,
  '42501', null, 'an admin cannot insert directly -- summaries only ever come from queueless_api'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000112', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*) from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111'),
  0::bigint, 'org B admin cannot see org A''s summary'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000111', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*) from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111'),
  0::bigint, 'staff (not admin) cannot see the summary either -- admin read only'
);
reset role;

select throws_ok(
  $$ insert into public.ops_summaries (org_id, day, report, ai_generated, aggregates)
     values ('a0000000-0000-0000-0000-000000000111', current_date + 2, 'x', true, 'not json') $$,
  '22P02', null, 'aggregates must be valid jsonb'
);

select * from finish(true);
rollback;
