-- get_token_status (0048): the anon-safe replacement for /t/[id]'s raw tokens read. Checks the
-- grant, the people_ahead count (same ordering countTokensAhead used client-side: lane_rank,
-- then priority_at, then number), and the 404 path for an unknown id.
begin;
select plan(6);

insert into public.organizations (id, slug, name, timezone) values
  ('44444444-4444-4444-4444-4444444444f0', 't-193', 'Token Status Org', 'UTC');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('bbbbbbbb-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-4444444444f0', 'G', 'General', true, 500);

select ok(
  has_function_privilege('anon', 'public.get_token_status(uuid)', 'EXECUTE'),
  'anon can execute get_token_status'
);

-- three normal-lane walk-ins, minted in order -- t1 is first in line, t3 is last
select id as t1_id, number as t1_num from private.mint_token(
  '44444444-4444-4444-4444-4444444444f0', 'bbbbbbbb-0000-0000-0000-0000000000d1', 'normal', null, 'W1', null, now(), null
) \gset
select id as t2_id from private.mint_token(
  '44444444-4444-4444-4444-4444444444f0', 'bbbbbbbb-0000-0000-0000-0000000000d1', 'normal', null, 'W2', null, now() + interval '1 second', null
) \gset
select id as t3_id from private.mint_token(
  '44444444-4444-4444-4444-4444444444f0', 'bbbbbbbb-0000-0000-0000-0000000000d1', 'normal', null, 'W3', null, now() + interval '2 seconds', null
) \gset

set local role anon;

select is(
  (select status from public.get_token_status(:'t1_id'::uuid)),
  'waiting'::public.token_status, 'anon gets the current status back'
);
select is(
  (select people_ahead from public.get_token_status(:'t1_id'::uuid)),
  0, 'the first token in the queue has nobody ahead of it'
);
select is(
  (select people_ahead from public.get_token_status(:'t3_id'::uuid)),
  2, 'the third token has the first two waiting tokens ahead of it'
);
select is(
  (select number from public.get_token_status(:'t1_id'::uuid)),
  :t1_num,
  'the returned row carries the real token number, not just status/people_ahead'
);

reset role;

select throws_ok(
  $$ select * from public.get_token_status('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'PGRST', null, 'an unknown token id 404s'
);

select * from finish(true);
rollback;
