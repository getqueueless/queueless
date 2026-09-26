-- P0: the very first render of /pay/[holdId] happens in an in-app browser with no session yet
-- (Payment work's own diagnosis -- their fetchPayableHold reads tokens/appointments directly via
-- the server client, which is anon at that point) -- and anon has zero access to appointments
-- (0047) and only a narrow, non-identifying column set on tokens (0065). Both are correct
-- lockdowns; neither leaves a path for a stranger with a hold's own id (from a payment link, not
-- guessable/enumerable) to see enough to pay it. get_payable_hold(p_id) is that path: a single
-- SECURITY DEFINER lookup across both tokens and appointments, returning only what a payment
-- screen needs, never anything identifying the patient.
create function public.get_payable_hold(p_id uuid)
returns table (
  id uuid,
  kind text,
  status text,
  fee_inr int,
  hold_expires_at timestamptz,
  doctor_id uuid,
  doctor_name text,
  specialty text,
  starts_at timestamptz,
  code text
)
language sql
security definer
stable
set search_path = ''
as $$
  select t.id, 'token'::text, t.status::text, t.fee_inr, t.hold_expires_at,
         t.doctor_id, d.name, d.specialty, null::timestamptz, t.code
  from public.tokens t
  left join public.doctors d on d.id = t.doctor_id
  where t.id = p_id and t.status in ('pending_payment', 'waiting')
  union all
  select a.id, 'appointment'::text, a.status::text, a.fee_inr, a.hold_expires_at,
         a.doctor_id, d.name, d.specialty, a.starts_at, null::text
  from public.appointments a
  left join public.doctors d on d.id = a.doctor_id
  where a.id = p_id and a.status in ('pending_payment', 'booked')
  limit 1;
$$;

revoke execute on function public.get_payable_hold(uuid) from public;
grant execute on function public.get_payable_hold(uuid) to anon, authenticated;
