-- 0062: payments_ledger must run as the querying role (security_invoker), and neither anon nor
-- authenticated should be able to query it directly any more -- payments_ledger_report is the
-- one door, unaffected because it's SECURITY DEFINER and runs as its owner regardless.
--
-- Org-scoped admin read access to the raw `payments` table itself is 0053's own territory
-- (payments_admin_read, already on main) -- not retested here, see 0062's header for why this
-- migration deliberately doesn't touch it.
begin;
select plan(3);

select is(
  (select reloptions from pg_class where oid = 'public.payments_ledger'::regclass)::text,
  '{security_invoker=on}', 'payments_ledger runs with security_invoker on'
);
select is(
  has_table_privilege('authenticated', 'public.payments_ledger', 'SELECT'),
  false, 'authenticated cannot select the view directly any more'
);
select is(
  has_table_privilege('anon', 'public.payments_ledger', 'SELECT'),
  false, 'anon still cannot select the view (0063 already closed this half)'
);

select * from finish(true);
rollback;
