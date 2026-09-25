-- walkin_patients and cash_receipts have NO direct select grant at all, even to authenticated
-- (by design -- see 0041's comments: phone numbers and receipts only ever come back through
-- the SECURITY DEFINER functions below). So every raw read of those two tables in this file
-- runs as postgres, immediately after `reset role`, never while impersonating a patient/staff
-- JWT -- that's not a test-authoring workaround, it's this file proving the lockdown is real.
begin;
select plan(20);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000160', 't-160-a', 'Cash Org A', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000160', 't-160-b', 'Cash Org B', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000160', 'a0000000-0000-0000-0000-000000000160', 'A', 'Desk A', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr) values
  ('f0000000-0000-0000-0000-000000000160', 'a0000000-0000-0000-0000-000000000160', 'c0000000-0000-0000-0000-000000000160', 'Dr. Z', 'Gen', 250);

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000160', 'staff160@queueless.test'),
  ('11100000-0000-0000-0000-000000000161', 'admin160@queueless.test');
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000160' where id = '11100000-0000-0000-0000-000000000160';
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000160' where id = '11100000-0000-0000-0000-000000000161';

select is(relrowsecurity, true, 'walkin_patients has RLS on') from pg_class where oid = 'public.walkin_patients'::regclass;
select is(relrowsecurity, true, 'cash_receipts has RLS on') from pg_class where oid = 'public.cash_receipts'::regclass;
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
       and p.proname in ('staff_register_walkin', 'admin_refund_cash_receipt', 'my_cash_today',
                          'cash_report_by_staff', 'cash_report_by_doctor') $$,
  'anon can execute none of the cash-desk functions'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000160', 'role', 'authenticated')::text, true);
create temp table tok160 as select * from public.staff_register_walkin(
  'Ramesh Kumar', '+919876500001', '1975-03-04', 'male', 'Amritsar',
  'c0000000-0000-0000-0000-000000000160', 'f0000000-0000-0000-0000-000000000160', 'normal', true, null
);
grant select on tok160 to public;
select is((select walk_in_label from tok160), 'Ramesh Kumar', 'staff_register_walkin mints a token with the walk-in''s name as the label');
select is((select doctor_id from tok160), 'f0000000-0000-0000-0000-000000000160'::uuid, 'the token carries the chosen doctor');
select is((select count(*) from public.my_cash_today()), 1::bigint, 'my_cash_today shows this staff member''s one receipt so far today');
reset role;

select is(
  (select count(*) from public.walkin_patients where org_id = 'a0000000-0000-0000-0000-000000000160' and phone = '+919876500001'),
  1::bigint, 'exactly one walkin_patients row was created'
);
create temp table receipt160 as select * from public.cash_receipts where token_id = (select id from tok160);
grant select on receipt160 to public;
select is(
  (select receipt_no from receipt160),
  'R-' || to_char((private.service_day('a0000000-0000-0000-0000-000000000160', now())), 'YYYYMMDD') || '-0001',
  'the first receipt of the day is numbered 0001'
);
select is((select amount_inr from receipt160), 250, 'cash_received with no override defaults to the chosen doctor''s fee');

-- Same phone again, before the first ticket is resolved: already_active, and the walk-in row
-- is reused (find-or-create), not duplicated.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000160', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.staff_register_walkin(
       'Ramesh Kumar', '+919876500001', '1975-03-04', 'male', 'Amritsar',
       'c0000000-0000-0000-0000-000000000160', 'f0000000-0000-0000-0000-000000000160'
     ) $$,
  'PGRST', null, 'the same walk-in phone cannot get a second active ticket for the same service'
);

-- A second walk-in, no cash, custom amount ignored since cash_received is false.
create temp table tok160b as select * from public.staff_register_walkin(
  'Simran Dhillon', '+919876500002', '1990-01-01', 'female', 'Jalandhar',
  'c0000000-0000-0000-0000-000000000160', null, 'normal', false, 500
);
grant select on tok160b to public;
reset role;

select is(
  (select count(*) from public.walkin_patients where org_id = 'a0000000-0000-0000-0000-000000000160' and phone = '+919876500001'),
  1::bigint, 'still exactly one walkin_patients row -- find-or-create, not duplicated'
);
select is(
  (select count(*) from public.cash_receipts where token_id = (select id from tok160b)),
  0::bigint, 'no receipt is written when cash_received is false, even with an amount override'
);

-- Refund: admin only, negative amount, needs a reason, cannot refund a refund.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000160', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.admin_refund_cash_receipt(
       (select id from receipt160), 'test'
     ) $$,
  'PGRST', null, 'staff (not admin) cannot issue a refund'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000161', 'role', 'authenticated')::text, true);
create temp table refund160 as select * from public.admin_refund_cash_receipt(
  (select id from receipt160), 'Patient walked out'
);
select is((select amount_inr from refund160), -250, 'the refund is the exact negative of the original amount');
select throws_ok(
  $$ select public.admin_refund_cash_receipt((select id from refund160), 'again') $$,
  'PGRST', null, 'a refund cannot itself be refunded'
);
reset role;

select throws_ok(
  $$ update public.cash_receipts set amount_inr = 0 where id = (select id from receipt160) $$,
  'P0001', null, 'cash_receipts rejects any update, even as postgres -- append-only by trigger, not just by grant'
);
select throws_ok(
  $$ insert into public.cash_receipts (org_id, patient_phone, amount_inr, receipt_no, collected_by)
     values ('a0000000-0000-0000-0000-000000000160', '+919999999999', -50, 'R-BAD', '11100000-0000-0000-0000-000000000160') $$,
  '23514', null, 'a negative amount with no refund_of violates the refund-shape check constraint'
);

-- Org isolation on the admin reports.
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000162', 'adminB160@queueless.test');
update public.profiles set role = 'admin', org_id = 'b0000000-0000-0000-0000-000000000160' where id = '11100000-0000-0000-0000-000000000162';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000162', 'role', 'authenticated')::text, true);
select is(
  (select count(*) from public.cash_report_by_staff(current_date - 1, current_date + 1)),
  0::bigint, 'org B''s admin sees no receipts from org A in cash_report_by_staff'
);
select is(
  (select count(*) from public.cash_report_by_doctor(current_date - 1, current_date + 1)),
  0::bigint, 'org B''s admin sees no receipts from org A in cash_report_by_doctor'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000161', 'role', 'authenticated')::text, true);
select cmp_ok(
  (select total_inr from public.cash_report_by_doctor(current_date - 1, current_date + 1) where doctor_id = 'f0000000-0000-0000-0000-000000000160'),
  '=', 0::bigint, 'org A''s own report nets the receipt and its refund to zero'
);
reset role;

select * from finish(true);
rollback;
