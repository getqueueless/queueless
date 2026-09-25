begin;
select plan(7);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444461', 't-061', 'Counter State Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-000000000061', '44444444-4444-4444-4444-444444444461', 'G', 'General', true, 500);

insert into public.counters (id, org_id, name, state)
values
  ('cccccccc-0000-0000-0000-000000000011', '44444444-4444-4444-4444-444444444461', 'Desk 1', 'closed'),
  ('cccccccc-0000-0000-0000-000000000012', '44444444-4444-4444-4444-444444444461', 'Desk 2', 'open');

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000061', 'p061staff@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000062', 'p061rando@queueless.test');
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-444444444461'
  where id = '55555555-0000-0000-0000-000000000061';

create temp table busy_token as
  select * from private.mint_token('44444444-4444-4444-4444-444444444461','bbbbbbbb-0000-0000-0000-000000000061','normal',null,'W1',null,now(),null);
update public.tokens set counter_id = 'cccccccc-0000-0000-0000-000000000012', status = 'called', called_at = now()
  where id = (select id from busy_token);

create or replace function pg_temp.try_set_state(
  p_counter uuid, p_state public.counter_state,
  out ok boolean, out err_code text, out ctr public.counters
) as $$
declare v_message text;
begin
  ok := true;
  begin
    ctr := public.set_counter_state(p_counter, p_state);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000062', 'role', 'authenticated')::text, true);

create temp table s0 as select * from pg_temp.try_set_state('cccccccc-0000-0000-0000-000000000011', 'open');
select is(s0.err_code, 'forbidden', 'non-staff cannot change counter state') from s0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000061', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table s1 as select * from pg_temp.try_set_state('cccccccc-0000-0000-0000-000000000011', 'open');
select is(s1.ok, true, 'staff can open a closed counter') from s1;
select is((s1.ctr).state, 'open'::public.counter_state, 'counter state becomes open') from s1;

create temp table s2 as select * from pg_temp.try_set_state('cccccccc-0000-0000-0000-000000000012', 'paused');
select is(s2.err_code, 'counter_busy', 'cannot pause a desk holding a called/serving token') from s2;

create temp table s3 as select * from pg_temp.try_set_state('cccccccc-0000-0000-0000-000000000012', 'closed');
select is(s3.err_code, 'counter_busy', 'cannot close a busy desk either') from s3;

create temp table s4 as select * from pg_temp.try_set_state('cccccccc-0000-0000-0000-000000000011', 'closed');
select is(s4.ok, true, 'an idle desk can be paused/closed freely') from s4;

create temp table s5 as select * from pg_temp.try_set_state('00000000-0000-0000-0000-000000000099', 'open');
select is(s5.err_code, 'not_found', 'setting state on a nonexistent counter is not_found') from s5;

reset role;

select * from finish(true);
rollback;
