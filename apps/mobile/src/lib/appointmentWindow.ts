const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const istDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** Check-in (check_in, migration 0077) is open all of the appointment's own day, from
 * when the hospital opens, until 15min after the slot. */
export function isCheckInWindow(startsAt: Date, now: Date): boolean {
  return istDay(now) === istDay(startsAt) && now.getTime() <= startsAt.getTime() + FIFTEEN_MIN_MS;
}

/** Manual/CI sanity check — not run automatically at import time. Call `demo()` yourself to check. */
export function demo() {
  const slot = new Date('2026-01-01T10:00:00Z');
  const at = (offsetMs: number) => new Date(slot.getTime() + offsetMs);

  console.assert(isCheckInWindow(slot, at(-3 * 60 * 60 * 1000)) === true, 'same day, 3h early');
  console.assert(isCheckInWindow(slot, at(-24 * 60 * 60 * 1000)) === false, 'the day before');
  console.assert(isCheckInWindow(slot, at(-5 * 60 * 1000)) === true, 'mid-window');
  console.assert(isCheckInWindow(slot, at(15 * 60 * 1000)) === true, 'just inside +15min boundary');
  console.assert(isCheckInWindow(slot, at(16 * 60 * 1000)) === false, 'just after +15min boundary');
}
