# Payments — online prepaid bookings

Razorpay **test mode**. Online-only, prepaid, for app/web tokens: tapping "Book & pay" holds
the spot for 10 minutes (the queue number is minted immediately, so the place is fair even
before payment clears), confirms on payment, releases the hold if unpaid. Refunds are automatic
when a doctor goes on leave, otherwise admin-approved.

## Database (`supabase/migrations/0050-0052`)

- `tokens.status` gained `pending_payment`; `tokens.hold_expires_at` / `tokens.fee_inr` are only
  ever set for a paid booking. `tokens_one_active` now also blocks a second concurrent hold.
- `public.start_paid_booking(p_doctor_id uuid)` — patient-facing (`authenticated`), mints the
  held token. Fee comes from `doctors.fee_inr`, never the client. Refuses a doctor with no fee,
  a doctor on leave today, or a closed service.
- `public.payments` — one row per Razorpay order attempt. RLS on, no direct grants; every read
  goes through `queueless_api`'s `select` grant + a matching RLS policy
  (`payments_api_read`), every write through the four functions below.
- `public.record_order` / `public.confirm_payment` / `public.mark_payment_failed` /
  `public.record_refund` — `SECURITY DEFINER`, `EXECUTE` granted **only to `queueless_api`**
  (apps/api's own DB role, called directly over asyncpg, never through PostgREST). Each returns
  the SQL `NULL` `payments` composite on rejection instead of raising `private.fail()` — that
  helper's PGRST-sqlstate convention is PostgREST-specific and apps/api doesn't parse it. A
  caller doing `SELECT * FROM fn(...)` gets one row of all-`NULL` columns back, not zero rows —
  check the primary key column (`id`), never `row IS NULL`.
- `confirm_payment` is idempotent (a replayed order id with the same payment id is a no-op, not
  an error) and amount-checked (a mismatched amount is rejected, never captured) — this is the
  defense-in-depth layer independent of whatever apps/api itself computed.
- `private.doctor_leave_refund_candidates()` — captured payments whose doctor has a leave
  covering today; drops a payment once it's refunded, no separate bookkeeping needed.
- `public.payments_ledger_report(from, to)` — admin-only, org-scoped, unifies `payments` and
  `cash_receipts` (via the `public.payments_ledger` view) into one report.
- `private.housekeeping()` gained a step: an unpaid hold past `hold_expires_at` is cancelled
  (same cron job, every 30s, no new schedule needed).

**Known ceiling:** if the 10-minute hold expires (token cancelled) in the narrow window between
Razorpay capturing the payment and `confirm_payment` running, the payment is still recorded
`captured` (the money is real) but the token is **not** resurrected — it's left for manual
reconciliation. Upgrade path: a dedicated `payment_expired` token status so `confirm_payment` can
tell an expiry-cancel apart from a patient-cancel and safely revive it. Not built — Razorpay
checkout + webhook normally resolve in well under 10 minutes, so this is a genuine edge case,
not the common path.

## API (`apps/api/app/payments/`)

All four routes are in `app/payments/routes.py`, included at `app/main.py`'s router list.

- `POST /payments/order` — `{token_id}` → `{order_id, amount_inr, currency, key_id, token_id}`.
  Requires the caller's own token (403 otherwise). Amount always comes from `tokens.fee_inr`,
  never the request body.
- `POST /payments/verify` — `{token_id, razorpay_order_id, razorpay_payment_id,
  razorpay_signature}` → `{status, token_status}`. Verifies the checkout.js callback's HMAC
  (`order_id|payment_id`, keyed by `RAZORPAY_KEY_SECRET`, constant-time) before calling
  `confirm_payment`.
- `POST /payments/razorpay/webhook` — no auth, the `X-Razorpay-Signature` header (raw-body HMAC,
  `RAZORPAY_WEBHOOK_SECRET`, a **different** secret from the key secret) is the only gate. Event
  id dedupe (`private.razorpay_webhook_events`) and the actual DB call share one transaction, so
  a genuine retry (Razorpay never saw a 2xx) is reprocessed cleanly rather than swallowed as
  "already seen." Configured events: `payment.captured`, `payment.failed`, `order.paid`,
  `refund.processed`, `refund.failed` (the last two are logged only — every refund is initiated
  by this app, which already calls `record_refund` itself).
- `POST /admin/refunds` — `{payment_id, reason}`, admin-only, org-scoped. Calls Razorpay's
  refund API then `record_refund`.
- `app/payments/refund_job.py` — a background loop (`doctor_leave_refund_loop`, started in
  `main.py`'s lifespan) polls `doctor_leave_refund_candidates()` every
  `DOCTOR_LEAVE_REFUND_INTERVAL_SECONDS` (default 60s), advisory-locked
  (`pg_try_advisory_xact_lock`, same pattern as `retrain_once`) so N replicas never double-refund.

Settings (`app/config.py`): `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`
are `Optional` — every payment route degrades to `503 payments_unavailable` when unset, the app
never crashes at startup over a missing key. Already set in the prod environment; see
`.env.example` for the local placeholder.

## Web (`apps/web/src/app/pay/`)

- `[tokenId]/page.tsx` — server component, reads the token + doctor (both already openly
  readable, same world `/t/[id]` relies on) and renders `PayView`.
- `[tokenId]/pay-view.tsx` — client component: fee summary, a live 10-minute countdown, the
  "Test payments — no real money" banner (with the UPI test id `success@razorpay`), Razorpay
  `checkout.js` (loaded on demand, `theme.color` `#0cb7d6`), `/payments/order` →
  `Razorpay.open()` → `/payments/verify` → live token. Handles failure/expiry/retry from
  `checkout.js`'s own `handler`/`modal.ondismiss` callbacks, no polling needed for the common
  path.
- `BookAndPayButton.tsx` — the small entry point a doctor-picker screen can embed: calls
  `start_paid_booking` then routes to `/pay/[token.id]`. Not wired into a booking screen yet
  (that screen doesn't exist on this branch) — this is the piece it imports once it does.
- `apps/web/src/lib/supabase/proxy.ts` gained `/^\/pay\/[^/]+$/` in `PUBLIC_PATH_PATTERNS` (same
  reason `/t/[id]` is public) — see that file's comment.

### Mobile handoff contract

Mobile opens `/pay/[tokenId]` in an **in-app browser** (no shared cookie jar with the web app),
carrying the patient's Supabase access token in the URL **fragment**, never a query string:

```
https://<web-origin>/pay/<tokenId>#access_token=<jwt>
```

The fragment is read once on mount, immediately stripped from the address bar
(`history.replaceState`) so it never lingers in browser history, and used directly as the
`Authorization: Bearer` value for `/payments/order` and `/payments/verify` — no cookie-based
Supabase session is needed or used in this mode. On a confirmed payment, the page redirects to

```
queueless://paid/<tokenId>
```

handing control back to the app (the scheme matches `apps/mobile/app.json`'s `scheme`). In
normal web mode (no fragment token), the page uses the browser's own Supabase session instead
and shows an in-page "View your token" link to `/t/[tokenId]` on success.

## Verifying a real payment

Razorpay test mode, UPI: `success@razorpay` always captures, any other UPI id fails. Cards: any
test number from Razorpay's docs. `RAZORPAY_WEBHOOK_SECRET` in prod must match exactly what's
configured in the Razorpay dashboard's webhook (`https://api.lpu.lol/payments/razorpay/webhook`,
events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`).

**Verified end to end against prod on 2026-09-25**, real HTTP calls throughout (`start_paid_booking`
over `sb.lpu.lol` PostgREST, `/payments/order` and `/payments/verify` over `api.lpu.lol`, a real
Razorpay test-mode checkout): a `pending_payment` hold (`OPD-008`, ₹250, Dr. Rajesh Iyer) → a real
Razorpay order (`order_TgQai1ozRKdyg3`) → checkout.js's card+OTP flow (test Mastercard
`5267 3181 8797 5449`, OTP `1234`) → `payment_TgQbRwI7mb6mTD` captured → `/payments/verify`'s HMAC
check passed → the token read back `status: "waiting"` from a fresh, independent REST call. The
`/v1/checkout.js` URL fix (below) was caught and shipped during this same pass — the first attempt
404'd on the wrong script path.

**Found, not fixed here (Razorpay dashboard config, not code):** UPI does not appear as a payment
method in the live checkout widget for this merchant account — only Cards, Netbanking and Wallet
are enabled, confirmed by inspecting the actual rendered payment-method list, not just the API
response. The page's own banner tells patients to pay with `success@razorpay` (UPI), which is not
actually selectable right now. Whoever has the Razorpay dashboard needs to enable UPI as a payment
method there; no `apps/web`/`apps/api` change is needed once that's on.
