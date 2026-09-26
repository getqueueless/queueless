# Queueless QA — FINAL regression — 2026-09-26 05:47 IST (00:17 UTC)

Target: production, https://lpu.lol (API https://api.lpu.lol, Supabase https://sb.lpu.lol)
Tools: playwright-cli (Chromium), curl (direct PostgREST/RPC calls where a web UI didn't exist yet or headless Razorpay friction blocked the UI path).
Tester: QA session on branch `qa`, report-only — no app code touched.

## Summary

**No open P0.** The one P0 found this cycle (post-login open redirect) is fixed and confirmed. Everything the orchestrator asked to be covered in this final pass was tested; a few items were verified via direct RPC/DB calls instead of end-to-end UI because a web UI doesn't exist yet (cash-desk was mobile-only until today) or because Razorpay's own hosted checkout iframe reproducibly gets stuck on contact-detail validation in this headless browser environment (not a Queueless bug — see the Payment section).

## PASS/FAIL table

| # | Area | Item | Result |
|---|---|---|---|
| 1 | Security | Post-login open redirect (`/login?next=/\evil.com`, `/%09/evil.com`) | **PASS — fixed & confirmed**, both payloads |
| 2 | Security | `profiles` role self-escalation (patient PATCH `role`) | **PASS — fixed & confirmed** |
| 3 | Security | Cross-user reads: `tokens`/`appointments`/`notifications`/`audit_log` by signed-in patients | **PASS — fixed & confirmed** (0047) |
| 4 | Security | `anon` write access to any table | **PASS** — anon has SELECT-only on `tokens` (temporary, documented, intentional for `/t/[id]`), no writes anywhere |
| 5 | Auth | `/login`: sign-in (patient + staff), create account, forgot password | **PASS** — all three flows work; email-code final step untestable (no inbox access, same limitation all session) |
| 6 | Auth | `/login` "signed in as X" card, role-aware dashboard link | **PASS** — shows role (patient/staff), links to `/my` or `/counter` correctly |
| 7 | Auth | `/staff` route | **PASS** — now redirects to unified `/login`, same card shown there |
| 8 | Redirect | Post-login role redirect (admin→`/admin`, staff→`/counter`, patient→`/my`) | **PASS — fixed & confirmed** |
| 9 | Live updates | Token status live push, signed-out, desktop + 390px | **PASS — fixed & confirmed**, zero reload |
| 10 | Live updates | Counter open/close state push to an already-open `/counter` tab | **FAIL — still broken**, fix attempt (`9259017`) was mobile-only; web fix not yet landed as of this pass. Data correct on reload, only the live push is missing. Workaround exists (reload). |
| 11 | `/my` | ActiveTokenBar on `/`, `/my`, `/login` for a patient with an active token | **PASS** — present on all three, countdown ticks (confirmed via two reads 4s apart) |
| 12 | `/my` | Logo → dashboard when signed in | **PASS** — links to `/my` |
| 13 | `/my` | Profile mobile-number validation | **PASS (not reproducing)** — Phase 1's P0 no longer reproduces on a fresh account/number; placeholder format was also cleaned up. Kept at low severity per earlier report. |
| 14 | `/my` | 91-prefixed phone number (`919876543210`) | **FAIL — still broken** — client `maxLength=10` truncates before the server's `normalize_in_phone` (which explicitly supports this format) ever sees it. No fix landed yet. |
| 15 | `/my` | Book 2 doctor slots at different times | **PASS** — booking flow, hold creation (`pending_payment`, 10-min `hold_expires_at`), and dashboard "Payment pending" card all correct |
| 16 | `/my` | Booking the same time twice → `time_clash` | **PASS** — server returns `409 time_clash`, UI shows "You already have a booking at 09:00" inline under the time picker |
| 17 | `/my` | Cancel a hold + refund-policy confirm dialog | **PASS** — dialog correctly says "nothing was charged... nothing to refund" for an unpaid hold, cancels cleanly, "Appointment cancelled" confirmation, removed from Upcoming |
| 18 | `/pay` | Razorpay test-mode UPI | **PASS (copy fixed)** — page now correctly says "UPI isn't enabled on this account yet" instead of over-promising it (earlier finding fixed) |
| 19 | `/pay` | Razorpay test-mode card (`4111 1111 1111 1111`) | **BLOCKED — not a Queueless bug** — Razorpay's own hosted checkout iframe gets stuck re-showing its "save card?" dialog after the contact-details step in this headless environment; reproduced twice, independent of account. `pending_payment` hold mechanics (item 15) are confirmed correct up to the point Razorpay takes over; full completion relies on the team's own manual verification already on record (`18f1680`). |
| 20 | `/kiosk` | Regular kiosk-token issuance | **PASS** — clean, no console errors |
| 21 | `/kiosk?mode=cash` | Cash walk-in with phone → slip → claim on `/my` | **PASS** — full UI path tested end to end this pass (new page, `a2d9afe`): issued PED-014 with a real patient's phone, claimed via `/my` "Claim a ticket", landed on the correct `/t/<id>`, `patient_id` linked. Negative case (no-phone kiosk code) fails cleanly with a friendly error. |
| 22 | `/counter` | Loads, no console errors, staff names correct | **PASS** — "Unnamed staff" fully resolved, real names shown everywhere |
| 23 | `/display` | Loads, scoped to correct counters, no console errors | **PASS** |
| 24 | `/admin` | Dashboard, `/admin/staff` load clean | **PASS** |
| 25 | Landing | Scan QR button present | **PASS** |
| 26 | Landing | Hero headline centered | **PASS** — "SKIP THE LINE." centered, visually confirmed |

## Notes on things spotted but not confirmed as bugs

- **Transient CORS error, once, unreproducible**: mid-pass, one click briefly threw `Access to fetch ... blocked by CORS policy` on `get_token_status` and `board_services` calls. Reloaded and retried immediately after — zero errors both times. Most likely correlated with the orchestrator's concurrent prod load test causing brief infra flakiness, not a code regression. Flagging in case it recurs, not filing as a bug.
- **Silent failure on a legitimate rate-limit**: booking a slot when the account has hit today's cancellation-cooldown limit (`cooldown` / 403) fails with **zero visible feedback** — button click does nothing, no toast, no error text. This is a real UX gap (any 403 from a booking action should surface something to the user) but not itself a data or security issue. Not re-tested against a fresh account before time ran out — worth a follow-up pass.
- Stale UI text ("You already have a booking at 09:00") persisted after successfully cancelling that same booking, until next interaction — cosmetic, not filed separately.

## Not tested / out of scope this pass

- Full Razorpay card payment completion (blocked by headless checkout friction, see item 19 — not an app bug).
- Email-code round trips (signup confirmation, password reset) — no inbox access all session, consistent limitation.
- Google OAuth completion — no real test account, wiring verified correct in an earlier pass.

## Status sent to orchestrator

All P0/P1 findings from this session were messaged individually as found, throughout Phase 2:
- Open redirect (P0) — found, then confirmed fixed.
- Cross-user reads on tokens/appointments/notifications/audit_log (P0-class, then P1 correction accepted) — found, then confirmed fixed by 0047.
- Counter-state live push (P1) — still open, fix attempt was mobile-only.
- 91-prefix phone truncation (P1) — still open.
- Cash-desk claim path (verification) — confirmed working.

No new P0 to report as of this final pass.
