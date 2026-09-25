-- Online prepaid bookings: a token can now be minted in 'pending_payment' (a held spot,
-- number already assigned so the queue position is fair) before it becomes a real 'waiting'
-- ticket. hold_expires_at is only ever set for these; fee_inr is the amount owed for this
-- specific ticket (denormalized off doctors.fee_inr at mint time, same pattern cash_receipts
-- already uses instead of joining back to doctors on every read).
alter table public.tokens add column hold_expires_at timestamptz;
alter table public.tokens add column fee_inr int check (fee_inr is null or fee_inr >= 0);

-- Replaces the 0004 index: a patient holding an unpaid spot counts as "active" too, same as
-- waiting/called/serving -- otherwise they could hold unlimited concurrent pending_payment
-- tickets for the same service.
drop index public.tokens_one_active;
create unique index tokens_one_active on public.tokens (patient_id, service_id)
  where status in ('pending_payment', 'waiting', 'called', 'serving');

create type public.payment_status as enum ('created', 'captured', 'failed', 'refunded');

-- One row per Razorpay order attempt (a patient can retry after a failed/expired attempt, so
-- token_id is NOT unique -- razorpay_order_id is, since Razorpay mints one per call). Every
-- write goes through record_order/confirm_payment/mark_payment_failed/record_refund
-- (SECURITY DEFINER, granted only to queueless_api below) -- apps/api is the only writer, and
-- it never connects as a patient's own role, so there is no RLS policy to write, only a
-- straight lockdown.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_id uuid not null references public.tokens (id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text,
  razorpay_refund_id text,
  amount_inr int not null check (amount_inr > 0),
  status public.payment_status not null default 'created',
  failure_reason text,
  refund_reason text,
  captured_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create index payments_token_id_idx on public.payments (token_id);
create index payments_org_id_created_idx on public.payments (org_id, created_at);
create unique index payments_razorpay_payment_id_key on public.payments (razorpay_payment_id)
  where razorpay_payment_id is not null;

alter table public.payments enable row level security;
-- No direct grants to anon/authenticated -- a patient never reads their own payment row
-- straight off this table (the web /pay page polls tokens.status instead, same open-read
-- world every other page already relies on). queueless_api gets a plain select (it needs
-- razorpay_payment_id/amount_inr to build a Razorpay refund call in POST /admin/refunds) plus
-- execute on the four RPCs below -- never insert/update directly, so every write is forced
-- through the validated, idempotent, amount-checked path.
revoke all on public.payments from public, anon, authenticated;
grant select on public.payments to queueless_api;

-- Dedupes Razorpay webhook deliveries (it retries on anything but a 2xx). `private` is never
-- exposed over PostgREST, so a plain table grant is enough -- same pattern as 0018's
-- private.token_notifications.
create table private.razorpay_webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
revoke all on private.razorpay_webhook_events from public, anon, authenticated;
grant select, insert on private.razorpay_webhook_events to queueless_api;

-- Internal building block for public.payments_ledger_report (below, in 0052) -- deliberately
-- NOT granted to anyone directly. Default view security (owner-privileges, i.e. NOT
-- security_invoker) is what lets it read straight through both locked-down tables; the admin
-- gate lives in the wrapper function, same split cash_report_by_staff/by_doctor already use
-- for cash_receipts.
create view public.payments_ledger as
  select 'online'::text as channel, p.id, p.org_id, p.token_id, p.amount_inr,
         p.razorpay_payment_id as reference, p.status::text as status, p.captured_at as at
  from public.payments p
  where p.status in ('captured', 'refunded')
  union all
  select 'cash'::text as channel, cr.id, cr.org_id, cr.token_id, cr.amount_inr,
         cr.receipt_no as reference,
         case when cr.refund_of is not null then 'refunded' else 'captured' end as status,
         cr.created_at as at
  from public.cash_receipts cr;
