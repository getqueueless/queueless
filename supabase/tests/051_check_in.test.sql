begin;
select plan(10);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444451', 't-051', 'Check In Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000041', '44444444-4444-4444-4444-444444444451', 'G', 'General', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000042', '44444444-4444-4444-4444-444444444451', 'P', 'Peds', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000043', '44444444-4444-4444-4444-444444444451', 'O', 'Ortho', true, 500);

insert into public.appointment_slots (id, service_id, starts_at, capacity, booked)
values
  ('dddddddd-0000-0000-0000-000000000021', 'bbbbbbbb-0000-0000-0000-000000000041', now() + interval '10 minutes', 1, 1),
  ('dddddddd-0000-0000-0000-000000000022', 'bbbbbbbb-0000-0000-0000-000000000042', now() + interval '2 hours', 1, 1),
  ('dddddddd-0000-0000-0000-000000000023', 'bbbbbbbb-0000-0000-0000-000000000043', now() - interval '1 hour', 1, 1);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000041', 'p051a@queueless.test');

insert into public.appointments (id, slot_id, service_id, patient_id, status)
values
  ('eeeeeeee-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000021', 'bbbbbbbb-0000-0000-0000-000000000041', '55555555-0000-0000-0000-000000000041', 'booked'),
  ('eeeeeeee-0000-0000-0000-000000000012', 'dddddddd-0000-0000-0000-000000000022', 'bbbbbbbb-0000-0000-0000-000000000042', '55555555-0000-0000-0000-000000000041', 'booked'),
  ('eeeeeeee-0000-0000-0000-000000000013', 'dddddddd-0000-0000-0000-000000000023', 'bbbbbbbb-0000-0000-0000-000000000043', '55555555-0000-0000-0000-000000000041', 'booked');

create or replace function pg_temp.try_checkin(p_appt uuid, out ok boolean, out err_code text, out tok public.tokens) as $$
declare v_message text;
begin
  ok := true;
  begin
    tok := public.check_in(p_appt);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000041', 'role', 'authenticated')::text, true);

-- too early: slot 2 hours out is outside the 30-minute-before window
create temp table k0 as select * from pg_temp.try_checkin('eeeeeeee-0000-0000-0000-000000000012');
select is(k0.err_code, 'checkin_window', 'checking in 2 hours early is outside the window') from k0;

-- too late: slot started 1 hour ago is outside the 15-minute-after window
create temp table k1 as select * from pg_temp.try_checkin('eeeeeeee-0000-0000-0000-000000000013');
select is(k1.err_code, 'checkin_window', 'checking in an hour late is outside the window') from k1;

-- happy path: slot starts in 10 minutes (early check-in orders by slot time)
create temp table k2 as select * from pg_temp.try_checkin('eeeeeeee-0000-0000-0000-000000000011');
select is(k2.ok, true, 'checking in inside the window succeeds') from k2;
select is((k2.tok).lane, 'appointment'::public.lane, 'minted token has the appointment lane') from k2;
select is((k2.tok).status, 'waiting'::public.token_status, 'minted token starts waiting') from k2;
select is(
  (k2.tok).priority_at,
  (select starts_at from public.appointment_slots where id = 'dddddddd-0000-0000-0000-000000000021'),
  'early check-in is ordered by the slot''s starts_at, not the actual check-in time'
) from k2;
select is(
  (select status from public.appointments where id = 'eeeeeeee-0000-0000-0000-000000000011'),
  'checked_in'::public.appointment_status,
  'appointment flips to checked_in'
);
select is(
  (select token_id from public.appointments where id = 'eeeeeeee-0000-0000-0000-000000000011'),
  (k2.tok).id,
  'appointment records the minted token id'
) from k2;

-- double check-in on the same appointment is illegal_transition
create temp table k3 as select * from pg_temp.try_checkin('eeeeeeee-0000-0000-0000-000000000011');
select is(k3.err_code, 'illegal_transition', 'checking in twice on the same appointment fails') from k3;

reset role;

-- state machine: cannot go directly from checked_in back to booked
create or replace function pg_temp.try_illegal_transition(out ok boolean, out err_code text) as $$
declare v_message text;
begin
  ok := true;
  begin
    update public.appointments set status = 'booked' where id = 'eeeeeeee-0000-0000-0000-000000000011';
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

select is((pg_temp.try_illegal_transition()).err_code, 'illegal_transition', 'trigger blocks checked_in -> booked');

select * from finish(true);
rollback;
