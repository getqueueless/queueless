-- Paid appointments: a slot can now be held the same way a walk-in token is -- 'pending_payment'
-- reserves the slot's capacity immediately (fair, like a token's number), released by
-- housekeeping if unpaid. hold_expires_at/fee_inr mirror tokens' own columns (0051) exactly.
alter table public.appointments add column hold_expires_at timestamptz;
alter table public.appointments add column fee_inr int check (fee_inr is null or fee_inr >= 0);

-- Replaces 0005's appointments_one_booked: a pending_payment hold counts as "active" too, same
-- reason tokens_one_active (0051) was widened -- otherwise a patient could hold unlimited
-- concurrent unpaid slot reservations for the same service.
drop index public.appointments_one_booked;
create unique index appointments_one_active on public.appointments (patient_id, service_id)
  where status in ('pending_payment', 'booked');

-- payments can now target either a token or an appointment (never both, never neither) -- a
-- paid appointment doesn't mint a token until check-in, same as an unpaid one, so there is
-- nothing else to attach the payment to at booking time.
alter table public.payments add column appointment_id uuid references public.appointments (id) on delete cascade;
alter table public.payments alter column token_id drop not null;
alter table public.payments add constraint payments_exactly_one_target check (
  (token_id is not null and appointment_id is null) or (token_id is null and appointment_id is not null)
);
create index payments_appointment_id_idx on public.payments (appointment_id);
