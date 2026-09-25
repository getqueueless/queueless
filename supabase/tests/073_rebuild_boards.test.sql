begin;
select plan(3);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444491', 't-073', 'Rebuild Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, default_service_secs, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-0000000000c1', '44444444-4444-4444-4444-444444444491', 'G', 'General', true, 300, 500);

insert into public.counters (id, org_id, name, state)
values ('cccccccc-0000-0000-0000-0000000000c1', '44444444-4444-4444-4444-444444444491', 'Desk 1', 'open');

create temp table tok1 as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444491','bbbbbbbb-0000-0000-0000-0000000000c1','normal',null,'W1',null,now(),null
);
create temp table tok2 as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444491','bbbbbbbb-0000-0000-0000-0000000000c1','normal',null,'W2',null,now(),null
);

update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-0000000000c1', called_at = now()
  where id = (select id from tok1);

-- corrupt the board rows directly, simulating drift
update public.board_services set waiting_count = 999, served_count = 999
  where service_id = 'bbbbbbbb-0000-0000-0000-0000000000c1';
update public.board_counters set token_code = 'WRONG', token_status = 'done'
  where counter_id = 'cccccccc-0000-0000-0000-0000000000c1';

select private.rebuild_boards('44444444-4444-4444-4444-444444444491', private.service_day('44444444-4444-4444-4444-444444444491', now()));

select is(
  (select waiting_count from public.board_services where service_id = 'bbbbbbbb-0000-0000-0000-0000000000c1'),
  1, 'rebuild_boards recomputes waiting_count from the real tokens (tok2 is still waiting)'
);
select is(
  (select token_code from public.board_counters where counter_id = 'cccccccc-0000-0000-0000-0000000000c1'),
  (select code from tok1), 'rebuild_boards fixes the corrupted board_counters row'
);
select is(
  (select token_status from public.board_counters where counter_id = 'cccccccc-0000-0000-0000-0000000000c1'),
  'called'::public.token_status, 'board_counters token_status matches the real token'
);

select * from finish(true);
rollback;
