begin;
select plan(10);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444471', 't-070', 'Sort Key Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000091', '44444444-4444-4444-4444-444444444471', 'G', 'General', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000092', '44444444-4444-4444-4444-444444444471', 'P', 'Peds', true, 500);

create or replace function pg_temp.try_update(p_sql text, out ok boolean, out err_code text) as $$
declare v_message text;
begin
  ok := true;
  begin
    execute p_sql;
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

create temp table tok as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444471','bbbbbbbb-0000-0000-0000-000000000091','normal',null,'W1',null,now(),null
);

select is(
  (pg_temp.try_update(format('update public.tokens set service_id = %L where id = %L', 'bbbbbbbb-0000-0000-0000-000000000092', (select id from tok)))).err_code,
  'illegal_transition', 'changing service_id is rejected'
);

select is(
  (pg_temp.try_update(format('update public.tokens set lane_rank = 0 where id = %L', (select id from tok)))).err_code,
  'illegal_transition', 'changing lane_rank is rejected'
);

select is(
  (pg_temp.try_update(format('update public.tokens set number = 999 where id = %L', (select id from tok)))).err_code,
  'illegal_transition', 'changing number is rejected'
);

select is(
  (pg_temp.try_update(format(
    'update public.tokens set priority_at = %L where id = %L',
    (select priority_at + interval '1 minute' from tok), (select id from tok)
  ))).err_code,
  'illegal_transition', 'moving priority_at later is rejected'
);

select is(
  (pg_temp.try_update(format(
    'update public.tokens set priority_at = %L where id = %L',
    (select priority_at - interval '1 minute' from tok), (select id from tok)
  ))).ok,
  true, 'moving priority_at earlier is allowed (verify_priority''s exception)'
);

-- valid state transitions
select is(
  (pg_temp.try_update(format('update public.tokens set status = %L, called_at = now() where id = %L', 'called', (select id from tok)))).ok,
  true, 'waiting -> called is allowed'
);

-- called -> called (recall) is allowed
select is(
  (pg_temp.try_update(format('update public.tokens set recall_count = recall_count + 1, called_at = now() where id = %L', (select id from tok)))).ok,
  true, 'called -> called (recall fields only) is allowed'
);

-- invalid: skip straight to done
select is(
  (pg_temp.try_update(format('update public.tokens set status = %L where id = %L', 'done', (select id from tok)))).err_code,
  'illegal_transition', 'called -> done directly (skipping serving) is rejected'
);

-- no_show -> called blocked once recall_count hits 2
update public.tokens set status = 'no_show', recall_count = 2 where id = (select id from tok);
select is(
  (pg_temp.try_update(format('update public.tokens set status = %L where id = %L', 'called', (select id from tok)))).err_code,
  'illegal_transition', 'no_show -> called is rejected once recall_count is already 2'
);

update public.tokens set recall_count = 1 where id = (select id from tok);
select is(
  (pg_temp.try_update(format('update public.tokens set status = %L where id = %L', 'called', (select id from tok)))).ok,
  true, 'no_show -> called is allowed while recall_count < 2'
);

select * from finish(true);
rollback;
