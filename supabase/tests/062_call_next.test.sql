begin;
select plan(10);

insert into public.organizations (id, slug, name, timezone)
values
  ('44444444-4444-4444-4444-444444444462', 't-062a', 'Call Next Org A', 'UTC'),
  ('44444444-4444-4444-4444-444444444463', 't-062b', 'Call Next Org B', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000071', '44444444-4444-4444-4444-444444444462', 'G', 'General', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000072', '44444444-4444-4444-4444-444444444462', 'P', 'Peds', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000073', '44444444-4444-4444-4444-444444444463', 'X', 'Other Org', true, 500);

insert into public.counters (id, org_id, name, state)
values
  ('cccccccc-0000-0000-0000-000000000021', '44444444-4444-4444-4444-444444444462', 'Desk 1', 'open'),
  ('cccccccc-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444462', 'Desk 2', 'closed'),
  ('cccccccc-0000-0000-0000-000000000023', '44444444-4444-4444-4444-444444444463', 'Desk 3', 'open');

insert into public.counter_services (counter_id, service_id)
values ('cccccccc-0000-0000-0000-000000000021', 'bbbbbbbb-0000-0000-0000-000000000071');

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000071', 'p062staff@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000072', 'p062rando@queueless.test');
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-444444444462'
  where id = '55555555-0000-0000-0000-000000000071';

-- emergency arrives last but must be served first; peds token is a different service and must be ignored
create temp table normal_tok as select * from private.mint_token('44444444-4444-4444-4444-444444444462','bbbbbbbb-0000-0000-0000-000000000071','normal',null,'N1',null, now() - interval '10 minutes', null);
create temp table peds_tok as select * from private.mint_token('44444444-4444-4444-4444-444444444462','bbbbbbbb-0000-0000-0000-000000000072','normal',null,'P1',null, now() - interval '20 minutes', null);
create temp table emergency_tok as select * from private.mint_token('44444444-4444-4444-4444-444444444462','bbbbbbbb-0000-0000-0000-000000000071','emergency',null,'E1',null, now(), null);
grant select on normal_tok, peds_tok, emergency_tok to authenticated;

create or replace function pg_temp.try_call_next(p_counter uuid, out ok boolean, out err_code text, out tok public.tokens) as $$
declare v_message text; v_rows public.tokens[];
begin
  ok := true;
  begin
    select array_agg(t) into v_rows from public.call_next(p_counter) t;
    tok := v_rows[1];
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000072', 'role', 'authenticated')::text, true);

create temp table c0 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000021');
select is(c0.err_code, 'forbidden', 'non-staff cannot call_next') from c0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000071', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table c1 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000022');
select is(c1.err_code, 'counter_closed', 'a closed desk cannot call_next') from c1;

create temp table c2 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000023');
select is(c2.err_code, 'forbidden', 'staff of org A cannot call_next on org B''s desk') from c2;

create temp table c3 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000021');
select is(c3.ok, true, 'open desk with matching waiting tokens calls one') from c3;
select is((c3.tok).id, (select id from emergency_tok), 'emergency is pulled first despite arriving last') from c3;
select is((c3.tok).status, 'called'::public.token_status, 'pulled token becomes called') from c3;

create temp table c4 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000021');
select is(c4.err_code, 'counter_busy', 'the desk cannot call another while already holding one') from c4;

update public.tokens set status = 'done', finished_at = now() where id = (select id from emergency_tok);

create temp table c5 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000021');
select is((c5.tok).id, (select id from normal_tok), 'next call pulls the remaining normal token, not the other service''s peds token') from c5;

update public.tokens set status = 'done', finished_at = now() where id = (select id from normal_tok);

create temp table c6 as select * from pg_temp.try_call_next('cccccccc-0000-0000-0000-000000000021');
select is(c6.ok, true, 'call_next with nobody waiting still succeeds') from c6;
select is((c6.tok is null), true, 'call_next returns nothing when nobody is waiting for this desk''s services') from c6;

reset role;

select * from finish(true);
rollback;
