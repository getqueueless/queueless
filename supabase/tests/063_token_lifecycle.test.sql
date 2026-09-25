begin;
select plan(17);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444470', 't-063', 'Lifecycle Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-000000000081', '44444444-4444-4444-4444-444444444470', 'G', 'General', true, 500);

insert into public.counters (id, org_id, name, state)
values
  ('cccccccc-0000-0000-0000-000000000031', '44444444-4444-4444-4444-444444444470', 'Desk 1', 'open'),
  ('cccccccc-0000-0000-0000-000000000032', '44444444-4444-4444-4444-444444444470', 'Desk 2', 'open');

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000081', 'p063staff@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000082', 'p063rando@queueless.test');
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-444444444470'
  where id = '55555555-0000-0000-0000-000000000081';

create or replace function pg_temp.mint(p_label text) returns uuid
security definer
as $$
  select id from private.mint_token(
    '44444444-4444-4444-4444-444444444470','bbbbbbbb-0000-0000-0000-000000000081',
    'normal', null, p_label, null, now(), null
  );
$$ language sql;

create or replace function pg_temp.try(p_fn text, p_token uuid, out ok boolean, out err_code text, out tok public.tokens) as $$
declare v_message text;
begin
  ok := true;
  begin
    case p_fn
      when 'start_serving' then tok := public.start_serving(p_token);
      when 'complete_token' then tok := public.complete_token(p_token);
      when 'skip_token' then tok := public.skip_token(p_token);
      when 'recall_token' then tok := public.recall_token(p_token);
    end case;
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

-- not signed in: no jwt claims set at all yet
create temp table t_anon as select pg_temp.mint('ANON') as id;
select is((pg_temp.try('start_serving', (select id from t_anon))).err_code, 'not_signed_in', 'must be signed in to start_serving');

-- non-staff forbidden
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000082', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t_forbidden as select pg_temp.mint('F1') as id;
grant select on t_forbidden to authenticated;
create temp table r0 as select * from pg_temp.try('start_serving', (select id from t_forbidden));
select is(r0.err_code, 'forbidden', 'non-staff cannot start_serving') from r0;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

-- start_serving: illegal on a waiting token
create temp table waiting1 as select pg_temp.mint('W1') as id;
grant select on waiting1 to authenticated;
create temp table r1 as select * from pg_temp.try('start_serving', (select id from waiting1));
select is(r1.err_code, 'illegal_transition', 'cannot start_serving a waiting token') from r1;

reset role;
update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-000000000031', called_at = now()
  where id = (select id from waiting1);
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

-- start_serving happy path
create temp table r2 as select * from pg_temp.try('start_serving', (select id from waiting1));
select is(r2.ok, true, 'start_serving succeeds on a called token') from r2;
select is((r2.tok).status, 'serving'::public.token_status, 'status becomes serving') from r2;

-- complete_token happy path
create temp table r3 as select * from pg_temp.try('complete_token', (select id from waiting1));
select is((r3.tok).status, 'done'::public.token_status, 'complete_token finishes the ticket') from r3;

-- complete_token illegal on a done token
create temp table r4 as select * from pg_temp.try('complete_token', (select id from waiting1));
select is(r4.err_code, 'illegal_transition', 'cannot complete an already-done ticket') from r4;

-- skip_token happy path
create temp table waiting2 as select pg_temp.mint('W2') as id;
grant select on waiting2 to authenticated;
reset role;
update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-000000000031', called_at = now()
  where id = (select id from waiting2);
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r5 as select * from pg_temp.try('skip_token', (select id from waiting2));
select is((r5.tok).status, 'skipped'::public.token_status, 'skip_token marks the ticket skipped') from r5;

-- recall_token: called -> called (recall_count increments), up to the cap
create temp table waiting3 as select pg_temp.mint('W3') as id;
grant select on waiting3 to authenticated;
reset role;
update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-000000000031', called_at = now() - interval '2 minutes'
  where id = (select id from waiting3);
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r6 as select * from pg_temp.try('recall_token', (select id from waiting3));
select is((r6.tok).status, 'called'::public.token_status, 'recalling a called ticket keeps it called') from r6;
select is((r6.tok).recall_count, 1::smallint, 'recall_count increments to 1') from r6;

create temp table r7 as select * from pg_temp.try('recall_token', (select id from waiting3));
select is((r7.tok).recall_count, 2::smallint, 'recall_count increments to 2') from r7;

create temp table r8 as select * from pg_temp.try('recall_token', (select id from waiting3));
select is(r8.err_code, 'illegal_transition', 'a third recall is rejected (max 2)') from r8;

-- free desk 1 first (waiting3 is still 'called' there from the recall-cap test above)
reset role;
update public.tokens set status = 'skipped' where id = (select id from waiting3);

-- recall_token: no_show -> called, only while the desk is free
create temp table waiting2b as select pg_temp.mint('W2b') as id;
grant select on waiting2b to authenticated;
update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-000000000031', called_at = now()
  where id = (select id from waiting2b);
update public.tokens set status = 'no_show' where id = (select id from waiting2b);

-- occupy desk 1 with something else so the desk is busy when we try to recall waiting2b
create temp table occupant as select pg_temp.mint('OCC') as id;
grant select on occupant to authenticated;
update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-000000000031', called_at = now()
  where id = (select id from occupant);

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r9 as select * from pg_temp.try('recall_token', (select id from waiting2b));
select is(r9.err_code, 'counter_busy', 'cannot recall a no-show back to a desk that is already serving someone') from r9;

reset role;
update public.tokens set status = 'skipped' where id = (select id from occupant);
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r10 as select * from pg_temp.try('recall_token', (select id from waiting2b));
select is(r10.ok, true, 'no_show recalls back to called once the desk is free') from r10;
select is((r10.tok).status, 'called'::public.token_status, 'status is called again') from r10;

reset role;
update public.tokens set status = 'skipped' where id = (select id from waiting2b);

-- skipped -> called via recall works the same way
create temp table waiting4 as select pg_temp.mint('W4') as id;
grant select on waiting4 to authenticated;
update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-000000000032', called_at = now()
  where id = (select id from waiting4);
update public.tokens set status = 'skipped' where id = (select id from waiting4);
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000081', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r11 as select * from pg_temp.try('recall_token', (select id from waiting4));
select is((r11.tok).status, 'called'::public.token_status, 'skipped -> called recall works too') from r11;

-- a currently-waiting token cannot be recalled
create temp table waiting5 as select pg_temp.mint('W5') as id;
grant select on waiting5 to authenticated;
create temp table r12 as select * from pg_temp.try('recall_token', (select id from waiting5));
select is(r12.err_code, 'illegal_transition', 'a waiting token cannot be recalled') from r12;

reset role;

select * from finish(true);
rollback;
