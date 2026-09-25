begin;
select plan(10);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444444', 't-040', 'Issue Token Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'G', 'General', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'X', 'Closed Svc', false, 500),
  ('bbbbbbbb-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444444', 'Y', 'Tiny Cap', true, 1);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000001', 'p040a@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000002', 'p040b@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000003', 'p040c@queueless.test');

-- issue_token requires a completed profile as of 0037; not what this file tests, so stamp it
-- directly rather than routing every fixture patient through complete_my_profile.
update public.profiles set profile_completed_at = now()
  where id in (
    '55555555-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-000000000002',
    '55555555-0000-0000-0000-000000000003'
  );

create or replace function pg_temp.try_issue(
  p_service uuid,
  out ok boolean, out err_code text, out retry_after text, out tok public.tokens
) as $$
declare
  v_message text;
  v_detail text;
begin
  ok := true;
  begin
    tok := public.issue_token(p_service);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
    err_code := v_message::jsonb ->> 'code';
    retry_after := v_detail::jsonb -> 'headers' ->> 'Retry-After';
  end;
end;
$$ language plpgsql;

-- not signed in: no jwt claims set at all
create temp table r0 as select * from pg_temp.try_issue('bbbbbbbb-0000-0000-0000-000000000001');
select is(r0.ok, false, 'not signed in: rejected') from r0;
select is(r0.err_code, 'not_signed_in', 'not signed in: error code') from r0;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

-- service closed
create temp table r1 as select * from pg_temp.try_issue('bbbbbbbb-0000-0000-0000-000000000002');
select is(r1.err_code, 'service_closed', 'closed service is rejected') from r1;

-- happy path
create temp table r2 as select * from pg_temp.try_issue('bbbbbbbb-0000-0000-0000-000000000001');
select is(r2.ok, true, 'happy path mints a token') from r2;
select is((r2.tok).status, 'waiting'::public.token_status, 'minted token is waiting') from r2;

-- already_active: same patient, same service, still waiting
create temp table r3 as select * from pg_temp.try_issue('bbbbbbbb-0000-0000-0000-000000000001');
select is(r3.err_code, 'already_active', 'second attempt on same service is already_active') from r3;
select is((r3.tok is null), true, 'already_active returns no new token') from r3;

reset role;

-- rate limited: mint 3 on tiny-cap-unrelated org via a fresh service each counts toward the 10-min
-- window regardless of service. Fixture inserted as postgres, before switching role -- tokens has
-- had real RLS since the security-hardening pass, so `authenticated` only ever writes through the
-- RPCs under test, never via a raw insert (same pattern the cooldown fixture below already used).
insert into public.tokens (org_id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, patient_id, created_at)
values
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 901, 'G-901', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000002', now() - interval '2 minutes'),
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 902, 'G-902', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000002', now() - interval '3 minutes'),
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 903, 'G-903', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000002', now() - interval '4 minutes');

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table r4 as select * from pg_temp.try_issue('bbbbbbbb-0000-0000-0000-000000000001');
select is(r4.err_code, 'rate_limited', '3 tokens in the last 10 minutes trips the rate limit') from r4;
select cmp_ok((r4.retry_after)::int, '>', 0, 'rate_limited carries a positive Retry-After') from r4;

reset role;

-- cooldown: 3 cancelled/no_show today for this org (fixture inserted as postgres, before switching role)
insert into public.tokens (org_id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, patient_id, created_at)
values
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001', private.service_day('44444444-4444-4444-4444-444444444444', now()), 801, 'G-801', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000003', now() - interval '1 hour'),
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001', private.service_day('44444444-4444-4444-4444-444444444444', now()), 802, 'G-802', 'normal', 1, now(), 'no_show', '55555555-0000-0000-0000-000000000003', now() - interval '2 hours'),
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001', private.service_day('44444444-4444-4444-4444-444444444444', now()), 803, 'G-803', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000003', now() - interval '3 hours');

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r5 as select * from pg_temp.try_issue('bbbbbbbb-0000-0000-0000-000000000001');
select is(r5.err_code, 'cooldown', '3 cancels/no-shows today trips the cooldown') from r5;

reset role;

select * from finish(true);
rollback;
