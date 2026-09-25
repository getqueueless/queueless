begin;
select plan(6);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444445', 't-041', 'Cancel Token Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-000000000011', '44444444-4444-4444-4444-444444444445', 'G', 'General', true, 500);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000011', 'p041a@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000012', 'p041b@queueless.test');

create temp table waiting_token as
  select * from private.mint_token(
    '44444444-4444-4444-4444-444444444445', 'bbbbbbbb-0000-0000-0000-000000000011',
    'normal', '55555555-0000-0000-0000-000000000011', null, null, now(), null
  );
grant select on waiting_token to authenticated;

create or replace function pg_temp.try_cancel(
  p_token uuid, out ok boolean, out err_code text, out tok public.tokens
) as $$
declare
  v_message text;
begin
  ok := true;
  begin
    tok := public.cancel_token(p_token);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000012', 'role', 'authenticated')::text, true);

create temp table r0 as select * from pg_temp.try_cancel((select id from waiting_token));
select is(r0.err_code, 'illegal_transition', 'cancelling someone else''s token is illegal_transition') from r0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000011', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r1 as select * from pg_temp.try_cancel((select id from waiting_token));
select is(r1.ok, true, 'owner can cancel their own waiting token') from r1;
select is((r1.tok).status, 'cancelled'::public.token_status, 'status becomes cancelled') from r1;

create temp table r2 as select * from pg_temp.try_cancel((select id from waiting_token));
select is(r2.ok, false, 'cancelling an already-cancelled token fails') from r2;
select is(r2.err_code, 'illegal_transition', 'code is illegal_transition') from r2;

reset role;

create temp table called_token as
  select * from private.mint_token(
    '44444444-4444-4444-4444-444444444445', 'bbbbbbbb-0000-0000-0000-000000000011',
    'normal', '55555555-0000-0000-0000-000000000011', null, null, now(), null
  );
update public.tokens set status = 'called' where id = (select id from called_token);
grant select on called_token to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000011', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table r3 as select * from pg_temp.try_cancel((select id from called_token));
select is(r3.err_code, 'illegal_transition', 'cannot cancel a called (non-waiting) token') from r3;

reset role;

select * from finish(true);
rollback;
