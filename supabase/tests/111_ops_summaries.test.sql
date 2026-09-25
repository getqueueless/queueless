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
  $$ insert into public.ops_summaries (org_id, day, lang, summary_text, model)
     values ('a0000000-0000-0000-0000-000000000111', current_date, 'en', 'Quiet day.', 'test-model') $$,
  'queueless_api can insert a summary'
);
select throws_ok(
  $$ insert into public.ops_summaries (org_id, day, lang, summary_text, model)
     values ('a0000000-0000-0000-0000-000000000111', current_date, 'en', 'dup', 'test-model') $$,
  '23505', null, 'the unique(org_id, day, lang) constraint rejects a duplicate'
);
select is(
  (select count(*) from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111'),
  1::bigint, 'queueless_api can select its own inserted row back'
);
select throws_ok(
  $$ update public.ops_summaries set summary_text = 'x'
     where org_id = 'a0000000-0000-0000-0000-000000000111' $$,
  '42501', null, 'queueless_api cannot update ops_summaries -- select/insert only, as asked'
);
select throws_ok(
  $$ delete from public.ops_summaries where org_id = 'a0000000-0000-0000-0000-000000000111' $$,
  '42501', null, 'queueless_api cannot delete ops_summaries'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000110', 'role', 'authenticated')::text,
  true
);
select is(
  (select summary_text from public.ops_summaries
     where org_id = 'a0000000-0000-0000-0000-000000000111' and day = current_date and lang = 'en'),
  'Quiet day.', 'org A admin reads their own org''s summary'
);
select throws_ok(
  $$ insert into public.ops_summaries (org_id, day, lang, summary_text, model)
     values ('a0000000-0000-0000-0000-000000000111', current_date, 'hi', 'x', 'test-model') $$,
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
  $$ insert into public.ops_summaries (org_id, day, lang, summary_text, model)
     values ('a0000000-0000-0000-0000-000000000111', current_date, 'fr', 'x', 'test-model') $$,
  '23514', null, 'lang is constrained to en/hi/pa -- fr is rejected'
);

select * from finish(true);
rollback;
