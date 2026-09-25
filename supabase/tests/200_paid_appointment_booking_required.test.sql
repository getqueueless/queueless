-- 0068: patients must pay for an appointment -- book_appointment (the free path) is staff/admin
-- only now; a patient gets 402 payment_required and has to use start_paid_appointment instead.
-- Separately, start_paid_appointment caps a patient at 2 concurrent unpaid (pending_payment)
-- holds, across services -- otherwise one patient could hold a slot per service (4 in this org)
-- for 10 minutes each, for free, denying them to everyone else.
begin;
select plan(5);

insert into public.organizations (id, slug, name, timezone)
values ('a0000000-0000-0000-0000-000000000200', 't-200', 'Paid Appt Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('b0000000-0000-0000-0000-000000000200', 'a0000000-0000-0000-0000-000000000200', 'A', 'Svc A', true, 500),
  ('b0000000-0000-0000-0000-000000000201', 'a0000000-0000-0000-0000-000000000200', 'B', 'Svc B', true, 500),
  ('b0000000-0000-0000-0000-000000000202', 'a0000000-0000-0000-0000-000000000200', 'C', 'Svc C', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active)
values
  ('d0000000-0000-0000-0000-000000000200', 'a0000000-0000-0000-0000-000000000200', 'b0000000-0000-0000-0000-000000000200', 'Dr. A', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000201', 'a0000000-0000-0000-0000-000000000200', 'b0000000-0000-0000-0000-000000000201', 'Dr. B', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000202', 'a0000000-0000-0000-0000-000000000200', 'b0000000-0000-0000-0000-000000000202', 'Dr. C', 'General', 400, true);
-- `now()` is constant for this whole transaction, so each slot needs a distinct offset --
-- otherwise these 3 "different time" slots would all collide with the new time_clash check.
insert into public.appointment_slots (id, service_id, doctor_id, starts_at, capacity, booked)
values
  ('e0000000-0000-0000-0000-000000000200', 'b0000000-0000-0000-0000-000000000200', 'd0000000-0000-0000-0000-000000000200', now() + interval '1 day', 1, 0),
  ('e0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000201', 'd0000000-0000-0000-0000-000000000201', now() + interval '2 days', 1, 0),
  ('e0000000-0000-0000-0000-000000000202', 'b0000000-0000-0000-0000-000000000202', 'd0000000-0000-0000-0000-000000000202', now() + interval '3 days', 1, 0);

insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000200', 'p200patient@queueless.test');
update public.profiles set profile_completed_at = now() where id = 'c0000000-0000-0000-0000-000000000200';

create or replace function pg_temp.try_book(p_slot uuid, out ok boolean, out err_code text) as $$
declare v_message text;
begin
  ok := true;
  begin
    perform public.book_appointment(p_slot);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

create or replace function pg_temp.try_hold(p_slot uuid, out ok boolean, out err_code text) as $$
declare v_message text;
begin
  ok := true;
  begin
    perform public.start_paid_appointment(p_slot);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000200', 'role', 'authenticated')::text, true);

select is(
  (pg_temp.try_book('e0000000-0000-0000-0000-000000000200')).err_code,
  'payment_required', 'a patient cannot use the free booking path -- 402 payment_required'
);

select is((pg_temp.try_hold('e0000000-0000-0000-0000-000000000200')).ok, true, 'hold 1 of 2 succeeds');
select is((pg_temp.try_hold('e0000000-0000-0000-0000-000000000201')).ok, true, 'hold 2 of 2 succeeds');
select is(
  (pg_temp.try_hold('e0000000-0000-0000-0000-000000000202')).err_code,
  'too_many_holds', 'a 3rd concurrent unpaid hold is refused, even for a different service'
);

reset role;

update public.profiles set role = 'staff' where id = 'c0000000-0000-0000-0000-000000000200';
set local role authenticated;
select is(
  (pg_temp.try_book('e0000000-0000-0000-0000-000000000202')).ok,
  true, 'staff/admin still book for free -- walk-in/phone bookings'
);
reset role;

select * from finish(true);
rollback;
