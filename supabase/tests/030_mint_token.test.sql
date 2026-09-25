begin;
select plan(15);

insert into public.organizations (id, slug, name, timezone)
values ('33333333-3333-3333-3333-333333333333', 't-030', 'Mint Token Org', 'UTC');

insert into public.services (id, org_id, code, name, max_tokens_per_day)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'A', 'Service A', 3),
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'B', 'Service B', 500),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'C', 'Service C', 500);

create or replace function pg_temp.try_mint(
  p_org uuid, p_service uuid, p_lane public.lane, p_patient uuid, p_walk_in_label text,
  p_appointment uuid, p_arrival timestamptz, p_issued_by uuid,
  out ok boolean, out err_code text, out tok public.tokens
) as $$
declare
  v_message text;
begin
  ok := true;
  begin
    tok := private.mint_token(p_org, p_service, p_lane, p_patient, p_walk_in_label, p_appointment, p_arrival, p_issued_by);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

create temp table m1 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','normal',null,'W1',null,now(),null);
select is((m1.tok).number, 1, 'A: first mint is number 1') from m1;
select is((m1.tok).code, 'A-001', 'A: code uses zero-padded number') from m1;
select is((m1.tok).lane_rank, 1::smallint, 'A: normal lane gets lane_rank 1') from m1;

create temp table m2 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','normal',null,'W2',null,now(),null);
select is((m2.tok).number, 2, 'A: second mint is number 2') from m2;

create temp table m3 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','normal',null,'W3',null,now(),null);
select is((m3.tok).number, 3, 'A: third mint is number 3 (cap reached)') from m3;

create temp table m4 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','normal',null,'W4',null,now(),null);
select is(m4.ok, false, 'A: 4th normal mint is rejected') from m4;
select is(m4.err_code, 'queue_full', 'A: rejection code is queue_full') from m4;

select is(
  (select last_number from private.service_days
     where service_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and day = private.service_day('33333333-3333-3333-3333-333333333333', now())),
  3,
  'A: last_number still 3 after rejected mint -- no gap, the bump rolled back with the failed request'
);

create temp table m5 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','emergency',null,'E1',null,now(),null);
select is(m5.ok, true, 'A: emergency mint succeeds past the cap') from m5;
select is((m5.tok).number, 4, 'A: emergency mint continues the real sequence (4th overall)') from m5;
select is((m5.tok).lane_rank, 0::smallint, 'A: emergency lane gets lane_rank 0') from m5;

create temp table m6 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000002','normal',null,'B1',null,now(),null);
select is((m6.tok).number, 1, 'B: independent counter starts at 1 regardless of A') from m6;

insert into private.service_days (service_id, day, last_number)
values ('aaaaaaaa-0000-0000-0000-000000000003', (private.service_day('33333333-3333-3333-3333-333333333333', now()) - 1), 99);

create temp table m7 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003','normal',null,'C1',null,now(),null);
select is(m7.ok, true, 'C: mint succeeds on a fresh day') from m7;
select is((m7.tok).number, 1, 'C: today starts at 1, independent of yesterday''s 99') from m7;

create temp table m8 as
  select * from pg_temp.try_mint('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003','normal',null,'C2',null,now(),null);
select is((m8.tok).number, 2, 'C: second mint today is 2') from m8;

select * from finish(true);
rollback;
