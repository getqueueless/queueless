# WaitWise — FINAL 10-minute smoke — 2026-09-26 06:48–06:53 IST (01:18–01:23 UTC)

Post demo-reset (06:50 IST). Target: production, https://lpu.lol. Tester: QA session, branch `qa`, report-only.

## Result: no P0.

## Pass/fail

| Area | Result |
|---|---|
| Landing page | **PASS** — title now "WaitWise", loads clean, 0 console errors |
| `/login` | **PASS** — "Sign in to WaitWise", clean |
| `/my`: take a token | **PASS** — self-serve "Take token" flow works |
| `/my`: priority step | **PASS** — "Do you need priority?" (None/Senior/Pregnant/Emergency) shows correctly after taking a token, with the "confirmed by staff, false claims move you back" copy |
| `/pay` page loads | **PASS** — clean navigation to `/pay/<id>`, 0 console errors (full card completion still blocked by Razorpay's own headless-checkout friction, consistent with every earlier pass — not a WaitWise bug) |
| Working-hours gate (0075/0076) | **PASS** — confirmed NOT blocking walk-ins pre-9AM despite "Opens at 9 AM" hint text; take-token → priority → pay all proceeded normally before 9 AM local time. Revert (0076) is holding. |
| `/t/<id>` live update | **PASS** — confirmed via the doctor-desk flow below |
| `/display/<service>` live update | **PASS** — "Now serving" flipped to the newly-called token with zero reload |
| `/counter` + `/doctor`: Next moves `/t` and `/display` live | **PASS** — full N/S/D cycle tested on Dr. Neha Sharma's now-bound desk (Room OPD-101): Next correctly called the earliest-waiting token (OPD-006, not just what "Up next" previewed), desk state flipped CALLED → WITH THE DOCTOR → cleared; `/display` updated to "Now serving OPD-006, Counter Room OPD-101" with no reload. Doctor-counter binding (confirmed live earlier, all 8 rooms) working as intended. |
| `/kiosk?mode=cash` | **PASS** — issued a real cash walk-in (OPD-009) for Dr. Neha Sharma, correct slip, no errors |
| `/faq` | **PASS** — loads clean, full question list present |
| `/faq` Ask | **PASS** — submitted a real question, got a correct AI-written answer citing the matching FAQ entry, 0 console errors |
| `/admin` pages | **PASS** — dashboard loads clean |
| `/slip/<id>` (case sheet + print) | **PASS** — loads clean ("OPD case sheet | WaitWise"), Print button present |

## Cleanup

- Cash walk-in token **OPD-009** ("Smoke Test Neha", Dr. Neha Sharma) is still in the waiting queue (position 2, behind a real demo-seeded token, OPD-008 "Divya"). **Deliberately left in place** rather than calling/clearing it — doing so would have required calling Next past OPD-008 first, and that token is part of the curated demo-reset state the orchestrator asked to keep intact for the 07:15 judging demo. Recommend staff clear OPD-009 manually (Skip/Done) right before the demo starts, or via the next demo-reset.
- The `pending_payment` appointment hold created while testing the priority step (Dr. Arjun Menon, patient `QA_PATIENT2`) needs no action — it self-expires automatically in its normal 10-minute hold window.

## Status

No P0 found this pass. Sent to orchestrator.
