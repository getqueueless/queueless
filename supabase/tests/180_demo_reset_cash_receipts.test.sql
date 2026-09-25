-- private.demo_reset_cash_receipts is the one sanctioned bypass of cash_receipts' append-only
-- triggers (0041) -- demo-reset.sh calls it directly as postgres, so most of what matters here
-- is proving it does NOT leak its session_replication_role='replica' bypass past its own call
-- (0043's whole point), plus the ordinary org/day scoping and grant checks every other private
-- helper gets.
begin;
select plan(8);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000180', 't-180-a', 'Reset Org A', 'Asia/Kolkata'),
  ('b0000000-0000-0000-0000-000000000180', 't-180-b', 'Reset Org B', 'Asia/Kolkata');
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000180', 'staff180@queueless.test');
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000180' where id = '11100000-0000-0000-0000-000000000180';

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace and p.proname = 'demo_reset_cash_receipts'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) $$,
  'neither anon nor authenticated can execute the bypass'
);
select ok(
  has_function_privilege('service_role', 'private.demo_reset_cash_receipts(uuid,date)'::regprocedure, 'EXECUTE'),
  'service_role can execute the bypass'
);

-- today's receipt in org A, a receipt from yesterday in org A, and a receipt in org B today --
-- only the first should go.
insert into public.cash_receipts (org_id, patient_phone, amount_inr, receipt_no, collected_by, created_at) values
  ('a0000000-0000-0000-0000-000000000180', '+919876500001', 200, 'R-TODAYA', '11100000-0000-0000-0000-000000000180', now()),
  ('a0000000-0000-0000-0000-000000000180', '+919876500002', 200, 'R-YESTA', '11100000-0000-0000-0000-000000000180', now() - interval '1 day'),
  ('b0000000-0000-0000-0000-000000000180', '+919876500003', 200, 'R-TODAYB', '11100000-0000-0000-0000-000000000180', now());

select is(
  private.demo_reset_cash_receipts('a0000000-0000-0000-0000-000000000180', (now() at time zone 'Asia/Kolkata')::date),
  1, 'exactly one receipt (today, org A) is deleted'
);
select is(
  (select count(*) from public.cash_receipts where receipt_no = 'R-TODAYA'),
  0::bigint, 'the matching receipt is actually gone'
);
select is(
  (select count(*) from public.cash_receipts where receipt_no in ('R-YESTA', 'R-TODAYB')),
  2::bigint, 'yesterday''s receipt and the other org''s receipt were left alone'
);

select is(
  (select count(*) from public.audit_log where entity = 'cash_receipts' and action = 'demo_reset_cash_receipts'),
  1::bigint, 'the reset is itself audited'
);

-- The whole reason this is a real function instead of an ad-hoc DISABLE TRIGGER in the shell
-- script: `set local session_replication_role` must not still be 'replica' after this call
-- returns, or the append-only trigger would silently stop protecting cash_receipts for the
-- rest of this transaction. Try an ordinary mutation right after -- it must still be rejected.
select throws_ok(
  $$ update public.cash_receipts set amount_inr = 0 where receipt_no = 'R-YESTA' $$,
  'P0001', 'cash_receipts is append-only',
  'the append-only trigger is still armed immediately after the bypass call, same transaction'
);

-- a second call with nothing left to delete for that org/day is a clean no-op, not an error
select is(
  private.demo_reset_cash_receipts('a0000000-0000-0000-0000-000000000180', (now() at time zone 'Asia/Kolkata')::date),
  0, 're-running with nothing left to delete is a clean 0-row no-op'
);

select * from finish(true);
rollback;
