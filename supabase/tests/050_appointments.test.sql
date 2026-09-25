begin;
select plan(18);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444450', 't-050', 'Appointments Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-000000000031', '44444444-4444-4444-4444-444444444450', 'G', 'General', true, 500);

insert into public.appointment_slots (id, service_id, starts_at, capacity, booked)
values
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000031', now() + interval '5 minutes', 1, 0),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000031', now() + interval '2 hours', 1, 0),
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000031', now() + interval '3 hours', 1, 1),
  ('dddddddd-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000031', now() + interval '4 hours', 1, 0);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000031', 'p050a@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000032', 'p050b@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000033', 'p050c@queueless.test');

-- book_appointment requires a completed profile as of 0037; not what this file tests.
update public.profiles set profile_completed_at = now()
  where id in (
    '55555555-0000-0000-0000-000000000031',
    '55555555-0000-0000-0000-000000000032',
    '55555555-0000-0000-0000-000000000033'
  );

-- book_appointment is staff/admin-only as of 0068 (patients must pay, via
-- start_paid_appointment) -- this whole file tests book_appointment's own mechanics (slot
-- checks, caps, cancellation), not the payment gate, so every caller here is staff. The gate
-- itself gets its own dedicated assertion below, with a real patient.
update public.profiles set role = 'staff'
  where id in (
    '55555555-0000-0000-0000-000000000031',
    '55555555-0000-0000-0000-000000000032',
    '55555555-0000-0000-0000-000000000033'
  );

create or replace function pg_temp.try_book(p_slot uuid, out ok boolean, out err_code text, out appt public.appointments) as $$
declare v_message text;
begin
  ok := true;
  begin
    appt := public.book_appointment(p_slot);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

create or replace function pg_temp.try_cancel_appt(p_appt uuid, out ok boolean, out err_code text, out appt public.appointments) as $$
declare v_message text;
begin
  ok := true;
  begin
    appt := public.cancel_appointment(p_appt);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000031', 'role', 'authenticated')::text, true);

create temp table b0 as select * from pg_temp.try_book('dddddddd-0000-0000-0000-000000000001');
select is(b0.err_code, 'slot_closed', 'a slot starting within 15 minutes cannot be booked') from b0;

create temp table b1 as select * from pg_temp.try_book('dddddddd-0000-0000-0000-000000000003');
select is(b1.err_code, 'slot_full', 'a slot at capacity is rejected') from b1;

create temp table b2 as select * from pg_temp.try_book('dddddddd-0000-0000-0000-000000000002');
select is(b2.ok, true, 'booking a valid open slot succeeds') from b2;
select is((b2.appt).status, 'booked'::public.appointment_status, 'new appointment is booked') from b2;
select is(
  (select booked from public.appointment_slots where id = 'dddddddd-0000-0000-0000-000000000002'),
  1, 'slot booked count incremented atomically'
);

create temp table b3 as select * from pg_temp.try_book('dddddddd-0000-0000-0000-000000000004');
select is(b3.err_code, 'already_booked', 'a second booking for the same service is rejected') from b3;

grant select on b2 to authenticated;
reset role;

-- a real patient cannot use the free path at all (0068) -- must go through
-- start_paid_appointment instead
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000035', 'p050patient@queueless.test');
update public.profiles set profile_completed_at = now() where id = '55555555-0000-0000-0000-000000000035';
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000035', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table b_patient as select * from pg_temp.try_book('dddddddd-0000-0000-0000-000000000004');
select is(b_patient.err_code, 'payment_required', 'a patient caller is blocked from the free booking path') from b_patient;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000032', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table c0 as select * from pg_temp.try_cancel_appt((select (appt).id from b2));
select is(c0.err_code, 'not_found', 'a non-owner cannot cancel someone else''s appointment') from c0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000031', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table c1 as select * from pg_temp.try_cancel_appt((select (appt).id from b2));
select is(c1.ok, true, 'the owner can cancel their own booking') from c1;
select is((c1.appt).status, 'cancelled'::public.appointment_status, 'status becomes cancelled') from c1;
select is(
  (select booked from public.appointment_slots where id = 'dddddddd-0000-0000-0000-000000000002'),
  0, 'cancelling releases the slot capacity back'
);

create temp table c2 as select * from pg_temp.try_cancel_appt((select (appt).id from b2));
select is(c2.err_code, 'illegal_transition', 'cancelling an already-cancelled booking fails') from c2;

reset role;

-- a booking whose slot already started can no longer be cancelled
insert into public.appointment_slots (id, service_id, starts_at, capacity, booked)
values ('dddddddd-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000031', now() - interval '10 minutes', 1, 1);
insert into public.appointments (id, slot_id, service_id, patient_id, status, starts_at)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000031', '55555555-0000-0000-0000-000000000031', 'booked', now() - interval '10 minutes');

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000031', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table c3 as select * from pg_temp.try_cancel_appt('eeeeeeee-0000-0000-0000-000000000001');
select is(c3.err_code, 'illegal_transition', 'cannot cancel a booking whose slot already started') from c3;

reset role;

-- cooldown reuse: patient 33 has 3 cancelled/no_show tokens today for this org
insert into public.tokens (org_id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, patient_id, created_at)
values
  ('44444444-4444-4444-4444-444444444450', 'bbbbbbbb-0000-0000-0000-000000000031', private.service_day('44444444-4444-4444-4444-444444444450', now()), 701, 'G-701', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000033', now() - interval '1 hour'),
  ('44444444-4444-4444-4444-444444444450', 'bbbbbbbb-0000-0000-0000-000000000031', private.service_day('44444444-4444-4444-4444-444444444450', now()), 702, 'G-702', 'normal', 1, now(), 'no_show', '55555555-0000-0000-0000-000000000033', now() - interval '2 hours'),
  ('44444444-4444-4444-4444-444444444450', 'bbbbbbbb-0000-0000-0000-000000000031', private.service_day('44444444-4444-4444-4444-444444444450', now()), 703, 'G-703', 'normal', 1, now(), 'cancelled', '55555555-0000-0000-0000-000000000033', now() - interval '3 hours');

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000033', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table b4 as select * from pg_temp.try_book('dddddddd-0000-0000-0000-000000000003');
select is(b4.err_code, 'cooldown', 'cooldown blocks booking too, reusing the token-cancellation cooldown') from b4;

reset role;

-- 3-bookings-per-day cap (different services, so already_booked never fires here)
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000032', '44444444-4444-4444-4444-444444444450', 'P', 'Peds', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000033', '44444444-4444-4444-4444-444444444450', 'O', 'Ortho', true, 500),
  ('bbbbbbbb-0000-0000-0000-000000000034', '44444444-4444-4444-4444-444444444450', 'R', 'Pharm', true, 500);
insert into public.appointment_slots (id, service_id, starts_at, capacity, booked)
values
  ('dddddddd-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-000000000031', now() + interval '5 hours', 1, 0),
  ('dddddddd-0000-0000-0000-000000000012', 'bbbbbbbb-0000-0000-0000-000000000032', now() + interval '6 hours', 1, 0),
  ('dddddddd-0000-0000-0000-000000000013', 'bbbbbbbb-0000-0000-0000-000000000033', now() + interval '7 hours', 1, 0),
  ('dddddddd-0000-0000-0000-000000000014', 'bbbbbbbb-0000-0000-0000-000000000034', now() + interval '8 hours', 1, 0);
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000034', 'p050d@queueless.test');
update public.profiles set profile_completed_at = now(), role = 'staff' where id = '55555555-0000-0000-0000-000000000034';
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000034', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((pg_temp.try_book('dddddddd-0000-0000-0000-000000000011')).ok, true, 'booking 1 of 3 succeeds');
select is((pg_temp.try_book('dddddddd-0000-0000-0000-000000000012')).ok, true, 'booking 2 of 3 succeeds');
select is((pg_temp.try_book('dddddddd-0000-0000-0000-000000000013')).ok, true, 'booking 3 of 3 succeeds');
select is((pg_temp.try_book('dddddddd-0000-0000-0000-000000000014')).err_code, 'queue_full', 'the 4th booking today hits the daily cap');

reset role;

select * from finish(true);
rollback;
