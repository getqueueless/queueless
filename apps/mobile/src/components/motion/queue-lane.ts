// Mirrors apps/web/src/components/motion/queue-lane.ts line for line, so the app and /t/[id] move
// their lanes and map statuses identically. Change both together.

// Pure state for QueueTracker's lane and stage bar, kept out of the component
// so it can be checked with node (queue-lane.test.mjs).

export type TrackerStatus =
  | "pending_payment"
  | "waiting"
  | "called"
  | "serving"
  | "done"
  | "skipped"
  | "no_show"
  | "cancelled";

export const MAX_DOTS = 8;

// Booked -> Waiting -> You're next -> Called -> Done, straight from the DB
// status (and `ahead` for the waiting split).
export function stageOf(status: TrackerStatus, ahead: number | null) {
  if (status === "pending_payment") return 0;
  if (status === "waiting") return ahead === 0 ? 2 : 1;
  if (status === "called" || status === "serving") return 3;
  return 4;
}

export type Dot = { id: number; i: number; enter?: "front" | "back" };
export type Lane = { ahead: number | null; dots: Dot[]; leaving: Dot[]; next: number; added: number };

export function freshLane(ahead: number | null): Lane {
  const n = Math.min(ahead ?? 0, MAX_DOTS);
  return { ahead, dots: Array.from({ length: n }, (_, i) => ({ id: i, i })), leaving: [], next: n, added: 0 };
}

// One step of the lane, from the old `ahead` to the new one. Dots carry ids,
// so React keeps each person's element and CSS moves it: the front ones leave
// toward the counter, priority arrivals drop in at the front.
export function moveLane(lane: Lane, ahead: number | null): Lane {
  if (ahead === null || lane.ahead === null) return freshLane(ahead);
  const shown = Math.min(ahead, MAX_DOTS);
  let next = lane.next;
  if (ahead < lane.ahead) {
    const gone = lane.ahead - ahead;
    const leaving = lane.dots.slice(0, gone);
    const dots: Dot[] = lane.dots.slice(gone);
    while (dots.length < shown) dots.push({ id: next++, i: 0, enter: "back" });
    return { ahead, dots: dots.map((d, i) => ({ ...d, i })), leaving, next, added: 0 };
  }
  const added = ahead - lane.ahead;
  const arrivals: Dot[] = Array.from({ length: added }, () => ({ id: next++, i: 0, enter: "front" }));
  const dots = [...arrivals, ...lane.dots].slice(0, shown).map((d, i) => ({ ...d, i }));
  return { ahead, dots, leaving: [], next, added };
}
