-- Distinguishes an automatic doctor-leave refund from an admin-approved one directly on the
-- row, so the admin payments UI can split them without reading audit_log (queueless_api and
-- authenticated both have zero access there by design -- see 0036's comments). NULL = the
-- automatic doctor-leave job; a profile id = the admin who approved it via POST /admin/refunds.
alter table public.payments add column initiated_by uuid references public.profiles (id) on delete set null;

-- record_refund (0052) redefined (CREATE OR REPLACE, not editing 0052's file) to persist
-- p_initiated_by onto the row itself -- it was already a parameter, previously only folded into
-- the audit_log jsonb payload. Body otherwise unchanged.
create or replace function public.record_refund(
  p_payment_id uuid, p_razorpay_refund_id text, p_reason text, p_initiated_by uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  update public.payments
    set status = 'refunded', razorpay_refund_id = p_razorpay_refund_id,
        refund_reason = p_reason, refunded_at = now(), initiated_by = p_initiated_by
    where id = p_payment_id and status = 'captured'
    returning * into v_payment;

  if v_payment.id is not null then
    insert into public.audit_log (org_id, entity, entity_id, action, new)
    values (v_payment.org_id, 'payments', v_payment.id, 'refund',
      jsonb_build_object(
        'razorpay_refund_id', p_razorpay_refund_id, 'reason', p_reason, 'initiated_by', p_initiated_by
      ));
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_refund(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, text, text, uuid) to queueless_api;
