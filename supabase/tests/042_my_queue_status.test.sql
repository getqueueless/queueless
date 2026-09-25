begin;
select plan(12);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444446', 't-042', 'Queue Status Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000021', '44444444-4444-4444-4444-444444444446', 'G', 'General', true, 300, 5, 500),
  ('bbbbbbbb-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444446', 'H', 'No Counters', true, 300, 5, 500);

insert into public.counters (id, org_id, name, state)
values ('cccccccc-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444446', 'Desk 1', 'open');
insert into public.counter_services (counter_id, service_id)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000021');

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000021', 'p042a@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000022', 'p042mine@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000023', 'p042other@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000024', 'p042staff@queueless.test');
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-444444444446'
  where id = '55555555-0000-0000-0000-000000000024';

create temp table t1 as select * from private.mint_token('44444444-4444-4444-4444-444444444446','bbbbbbbb-0000-0000-0000-000000000021','normal','55555555-0000-0000-0000-000000000021',null,null, now() - interval '30 minutes', null);
create temp table mine as select * from private.mint_token('44444444-4444-4444-4444-444444444446','bbbbbbbb-0000-0000-0000-000000000021','normal','55555555-0000-0000-0000-000000000022',null,null, now() - interval '20 minutes', null);
create temp table t3 as select * from private.mint_token('44444444-4444-4444-4444-444444444446','bbbbbbbb-0000-0000-0000-000000000021','normal','55555555-0000-0000-0000-000000000023',null,null, now() - interval '10 minutes', null);
create temp table mine2 as select * from private.mint_token('44444444-4444-4444-4444-444444444446','bbbbbbbb-0000-0000-0000-000000000022','normal','55555555-0000-0000-0000-000000000022',null,null, now(), null);

grant select on mine, mine2 to authenticated;

create or replace function pg_temp.try_status(p_token uuid)
returns table (
  code text, status public.token_status, service_name text, "position" int, ahead int,
  eta_seconds int, counter_name text, called_at timestamptz, no_show_deadline timestamptz,
  recall_count smallint
) as $$
begin
  return query select * from public.my_queue_status(p_token);
exception when sqlstate 'PGRST' then
  return;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000023', 'role', 'authenticated')::text, true);

select is_empty($$ select * from pg_temp.try_status((select id from mine)) $$, 'unrelated patient gets nothing back (not_found)') ;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000024', 'role', 'authenticated')::text, true);
set local role authenticated;

select isnt_empty($$ select * from pg_temp.try_status((select id from mine)) $$, 'staff of the same org can view any token');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000022', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table s1 as select * from pg_temp.try_status((select id from mine));
select is(s1.service_name, 'General', 'owner sees the right service name') from s1;
select is(s1.ahead, 1, 'one token (t1) arrived earlier, so ahead = 1') from s1;
select is(s1.position, 2, 'position is ahead + 1') from s1;
select is(s1.eta_seconds, 600, 'eta = ceil(2/1 open counter) * 300s default = 600') from s1;
select is(s1.recall_count, 0::smallint, 'fresh token has recall_count 0') from s1;

create temp table s2 as select * from pg_temp.try_status((select id from mine2));
select is(s2.ahead, 0, 'sole waiting token in service H has nobody ahead') from s2;
select is(s2.eta_seconds, null, 'eta is null when no open counter serves the service, even with ahead = 0') from s2;

reset role;
update public.tokens set status = 'called', called_at = now(), counter_id = 'cccccccc-0000-0000-0000-000000000001'
  where id = (select id from mine);
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000022', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table s3 as select * from pg_temp.try_status((select id from mine));
select is(s3.ahead, null, 'ahead is null once the token is no longer waiting') from s3;
select is(s3.position, null, 'position is null once the token is no longer waiting') from s3;
select is(s3.counter_name, 'Desk 1', 'counter_name reflects the assigned desk once called') from s3;

reset role;

select * from finish(true);
rollback;
