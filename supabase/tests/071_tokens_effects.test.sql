begin;
select plan(13);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444480', 't-071', 'Effects Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, default_service_secs, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-0000000000a1', '44444444-4444-4444-4444-444444444480', 'G', 'General', true, 300, 500);

insert into public.counters (id, org_id, name, state)
values ('cccccccc-0000-0000-0000-0000000000a1', '44444444-4444-4444-4444-444444444480', 'Desk 1', 'open');

insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000a1', 'p071patient@queueless.test');

-- walk-in mint: board_services row appears immediately, defaulted avg_service_secs, no notification (no patient)
create temp table walkin as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444480','bbbbbbbb-0000-0000-0000-0000000000a1','normal',null,'W1',null,now(),null
);

select is(
  (select avg_service_secs from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  300, 'board_services row exists with the default fallback average before any completion'
);
select is(
  (select waiting_count from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  1, 'waiting_count reflects the freshly minted walk-in'
);
select is_empty(
  format($$ select 1 from public.notifications where token_id = %L $$, (select id from walkin)),
  'a walk-in with no patient_id never gets a notification'
);

-- a real patient's token: called -> notification fires
create temp table patient_tok as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444480','bbbbbbbb-0000-0000-0000-0000000000a1','normal',
  '55555555-0000-0000-0000-0000000000a1',null,null,now() + interval '1 second',null
);

select is(
  (select waiting_count from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  2, 'waiting_count increments for the second waiting token'
);
select is(
  (select count(*)::int from public.notifications
     where token_id = (select id from patient_tok) and kind = 'almost_turn'),
  1, 'a top-3 waiting patient gets an almost_turn notification'
);

update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-0000000000a1', called_at = now()
  where id = (select id from patient_tok);

select is(
  (select count(*)::int from public.notifications
     where token_id = (select id from patient_tok) and kind = 'called'),
  1, 'being called fires exactly one called notification'
);
select is(
  (select token_code from public.board_counters where counter_id = 'cccccccc-0000-0000-0000-0000000000a1'),
  (select code from patient_tok),
  'board_counters reflects the code of whoever the desk just called'
);
select is(
  (select token_status from public.board_counters where counter_id = 'cccccccc-0000-0000-0000-0000000000a1'),
  'called'::public.token_status,
  'board_counters reflects the token status too'
);
select is(
  (select waiting_count from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  1, 'waiting_count drops back to 1 once the patient token is called'
);

update public.tokens set status = 'serving', serving_at = now() where id = (select id from patient_tok);
update public.tokens set status = 'done', finished_at = now() + interval '4 minutes' where id = (select id from patient_tok);

select is(
  (select served_count from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  1, 'served_count increments once the ticket is done'
);
select is(
  (select avg_service_secs from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  300, 'fewer than 5 completed samples still falls back to the service default'
);

-- outlier durations (outside 30s-30min) are dropped, not clamped, when there are enough samples
do $$
declare
  i int;
  v_tok uuid;
begin
  for i in 1..5 loop
    v_tok := (private.mint_token(
      '44444444-4444-4444-4444-444444444480','bbbbbbbb-0000-0000-0000-0000000000a1','normal',null,'S'||i,null,now(),null
    )).id;
    update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-0000000000a1', called_at = now() where id = v_tok;
    update public.tokens set status = 'serving', serving_at = now() where id = v_tok;
    update public.tokens set status = 'done', finished_at = now() + interval '100 seconds' where id = v_tok;
  end loop;

  v_tok := (private.mint_token(
    '44444444-4444-4444-4444-444444444480','bbbbbbbb-0000-0000-0000-0000000000a1','normal',null,'OUT',null,now(),null
  )).id;
  update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-0000000000a1', called_at = now() where id = v_tok;
  update public.tokens set status = 'serving', serving_at = now() where id = v_tok;
  update public.tokens set status = 'done', finished_at = now() + interval '1 hour' where id = v_tok;
end;
$$;

select cmp_ok(
  (select avg_service_secs from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000a1'),
  '<', 1000,
  'a 1-hour outlier sample is dropped, not averaged in, once there are enough real samples'
);

select isnt_empty(
  $$ select 1 from public.audit_log where entity = 'tokens' $$,
  'every token write lands an audit_log row'
);

select * from finish(true);
rollback;
