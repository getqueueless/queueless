-- Patients have no read access to public.payments at all (0051/0053: admin-only, deliberately
-- not owner-read -- see test 105's assertion "the patient who paid cannot read the payments row
-- directly"). That leaves the patient-facing app with no way to show a Paid/Refunded chip for
-- their own token/appointment. This is the narrow door: only status/refunded_at/refund_reason,
-- only for a hold the caller actually owns, nothing else on the payments row ever exposed.
create function public.my_payment_status(p_token_id uuid default null, p_appointment_id uuid default null)
returns table (status public.payment_status, refunded_at timestamptz, refund_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.status, p.refunded_at, p.refund_reason
  from public.payments p
  left join public.tokens t on t.id = p.token_id
  left join public.appointments a on a.id = p.appointment_id
  where auth.uid() is not null
    and (
      (p_token_id is not null and p.token_id = p_token_id and t.patient_id = auth.uid())
      or (p_appointment_id is not null and p.appointment_id = p_appointment_id and a.patient_id = auth.uid())
    )
  order by p.created_at desc
  limit 1;
$$;

revoke all on function public.my_payment_status(uuid, uuid) from public, anon;
grant execute on function public.my_payment_status(uuid, uuid) to authenticated;
