-- Lets an org admin read their own org's online payments directly (the admin cash/payments
-- report page can now `.from('payments').select(...)` under RLS instead of only through
-- payments_ledger_report). Reuses private.is_admin_of (0029), same helper 0045's profiles RLS
-- uses, rather than hand-rolling the org+role check again.
--
-- payments_ledger (0051, the online+cash union) is deliberately left alone here: making it
-- security_invoker and readable this way would need cash_receipts to grant an equivalent
-- policy too, which isn't this migration's call -- cash_receipts' owner (0041) explicitly
-- revoked all direct access, even to authenticated, specifically to keep patient_phone off any
-- raw admin select (only the aggregate cash_report_by_staff/by_doctor functions expose it,
-- never per-row). Verified empirically (not just reasoned): a security_invoker view whose
-- UNION ALL touches a table the caller has no grant on raises "permission denied" for the
-- WHOLE query, not a graceful partial result -- so payments_ledger_report() (still
-- SECURITY DEFINER, unaffected by any of this) remains the only unified read until cash_receipts
-- gets its own admin-read policy from its own owner.
create policy payments_admin_read on public.payments for select to authenticated
  using (private.is_admin_of(org_id));

grant select on public.payments to authenticated;
