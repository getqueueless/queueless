const THIRTY_MIN_MS = 30 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/** Check-in opens 30min before a slot and stays open until 15min after it. */
export function isCheckInWindow(startsAt: Date, now: Date): boolean {
  const diff = startsAt.getTime() - now.getTime();
  return diff <= THIRTY_MIN_MS && diff >= -FIFTEEN_MIN_MS;
}

/** Manual/CI sanity check — not run automatically at import time. Call `demo()` yourself to check. */
export function demo() {
  const slot = new Date('2026-01-01T10:00:00Z');
  const at = (offsetMs: number) => new Date(slot.getTime() + offsetMs);

  console.assert(isCheckInWindow(slot, at(-45 * 60 * 1000)) === false, 'well before window (45min early)');
  console.assert(isCheckInWindow(slot, at(-30 * 60 * 1000)) === true, 'just inside -30min boundary');
  console.assert(isCheckInWindow(slot, at(-5 * 60 * 1000)) === true, 'mid-window');
  console.assert(isCheckInWindow(slot, at(15 * 60 * 1000)) === true, 'just inside +15min boundary');
  console.assert(isCheckInWindow(slot, at(16 * 60 * 1000)) === false, 'just after +15min boundary');
}
