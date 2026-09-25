"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { MAX_DOTS, freshLane, moveLane, stageOf, type TrackerStatus } from "./queue-lane";
import { RolodexWord } from "./RolodexWord";
import styles from "./QueueTracker.module.css";

export type { TrackerStatus };

export type QueueTrackerProps = {
  status: TrackerStatus;
  /** Waiting tokens ordered ahead of this one; null when unknown. */
  ahead: number | null;
  /** Current predicted wait, whole minutes; null when there is no estimate. */
  etaMinutes: number | null;
  /** The first estimate this token got; the ring's 0%. */
  etaAtJoin: number | null;
  /** The assigned counter's name ("3", "Counter 3"); null until called. */
  counterCode: string | null;
  /** The service's most recently called token code. */
  nowServingNumber: string | null;
  serviceName: string | null;
};

const ENDED: Partial<Record<TrackerStatus, { label: string; text: string }>> = {
  skipped: { label: "Skipped", text: "You were skipped. Check in with the counter." },
  no_show: { label: "No-show", text: "Marked as a no-show. See the counter to be re-added." },
  cancelled: { label: "Cancelled", text: "This token was cancelled." },
};

// Stroke icons, 24px grid, same weight as the landing page's step icons.
const ICONS: ReactNode[] = [
  <g key="booked">
    <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
    <path d="M15 5v2m0 3v2m0 3v2" />
  </g>,
  <g key="waiting">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </g>,
  <g key="next">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </g>,
  <g key="called">
    <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </g>,
  <path key="done" d="M5 12.5 9.5 17 19 7.5" />,
];
const ICON_ENDED = <path d="M7 7l10 10M17 7 7 17" />;

// The waiting screen for /t/[id], Zomato and Domino's style. It renders only
// what it is given: every number is real data from the page, and nothing here
// advances on its own clock. Reduced motion shows the same states, still.
export function QueueTracker({
  status,
  ahead,
  etaMinutes,
  etaAtJoin,
  counterCode,
  nowServingNumber,
  serviceName,
}: QueueTrackerProps) {
  // Called or being served: nobody is ahead any more, you are at the counter.
  const atCounter = status === "called" || status === "serving";
  const laneAhead = atCounter ? 0 : ahead;
  const [lane, setLane] = useState(() => freshLane(laneAhead));
  // Adjust state while rendering when `ahead` changes (React's documented
  // pattern), so the lane moves in the same commit as the new number.
  if (laneAhead !== lane.ahead) setLane(moveLane(lane, laneAhead));

  const ended = ENDED[status];
  const stage = stageOf(status, ahead);
  const counter = !counterCode ? "Counter" : /^counter\b/i.test(counterCode) ? counterCode : `Counter ${counterCode}`;
  const live = status === "waiting" || status === "called" || status === "serving";

  const labels = ["Booked", "Waiting", "You’re next", status === "serving" ? "With the doctor" : "Called", ended?.label ?? "Done"];
  const detail = ended
    ? ended.text
    : status === "pending_payment"
      ? "Payment pending."
      : status === "called"
        ? `Go to ${counter}.`
        : status === "serving"
          ? "With the doctor."
          : status === "done"
            ? "Visit complete. Thank you."
            : null;

  // The ring: share of the first estimate already waited out.
  const progress = atCounter
    ? 1
    : etaMinutes !== null && etaAtJoin
      ? Math.min(1, Math.max(0, 1 - etaMinutes / etaAtJoin))
      : 0;
  const ringLabel = atCounter
    ? "Your turn now."
    : etaMinutes === null
      ? "No wait estimate yet."
      : `Estimated wait about ${etaMinutes} ${etaMinutes === 1 ? "minute" : "minutes"}, ${Math.round(progress * 100)}% of it done.`;

  const overflow = laneAhead !== null && laneAhead > MAX_DOTS ? laneAhead - MAX_DOTS : 0;
  const youAt = lane.dots.length + (overflow ? 1 : 0);
  const laneLabel =
    laneAhead === null
      ? ""
      : `${laneAhead === 0 ? "Nobody" : laneAhead === 1 ? "1 person" : `${laneAhead} people`} ahead of you${
          serviceName ? ` in the ${serviceName} queue` : ""
        }, then ${counter}.`;

  return (
    <div className={styles.tracker} data-status={status}>
      {live && (
        <div className={styles.ring} role="img" aria-label={ringLabel}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className={styles.ringTrack} cx="60" cy="60" r="52" />
            <circle
              className={styles.ringArc}
              cx="60"
              cy="60"
              r="52"
              pathLength={100}
              style={{ "--p": progress } as CSSProperties}
            />
          </svg>
          <span className={styles.ringCentre} aria-hidden="true">
            {atCounter ? (
              <span className={styles.ringNow}>Now</span>
            ) : etaMinutes === null ? (
              <span className={styles.ringNone}>No estimate yet</span>
            ) : (
              <>
                <span className={styles.ringMins} style={{ "--eta": Math.round(etaMinutes) } as CSSProperties} />
                <span className={styles.ringUnit}>min</span>
              </>
            )}
          </span>
        </div>
      )}

      {live && laneAhead !== null && (
        <div className={styles.laneWrap}>
          <div className={styles.lane} role="img" aria-label={laneLabel}>
            <div className={styles.laneTrack} aria-hidden="true">
              {lane.leaving.map((d) => (
                <span key={d.id} className={styles.dot} data-leaving="" style={{ "--i": d.i } as CSSProperties} />
              ))}
              {lane.dots.map((d) => (
                <span key={d.id} className={styles.dot} data-enter={d.enter} style={{ "--i": d.i } as CSSProperties} />
              ))}
              {overflow > 0 && (
                <span className={styles.more} style={{ "--i": lane.dots.length } as CSSProperties}>
                  +{overflow}
                </span>
              )}
              <span className={styles.you} style={{ "--i": youAt } as CSSProperties}>
                <span className={styles.youTag}>You</span>
              </span>
            </div>
            <span className={styles.counter} aria-hidden="true">
              {counter}
            </span>
          </div>
          <p className={styles.note} role="status">
            {lane.added > 0 && (lane.added === 1 ? "Priority patient added" : `${lane.added} priority patients added`)}
          </p>
        </div>
      )}

      <ol
        className={styles.stages}
        aria-label="Progress"
        data-ended={ended ? "" : undefined}
        style={{ "--fill": ended ? 0 : stage / 4 } as CSSProperties}
      >
        {labels.map((label, i) => (
          <li
            key={i}
            className={styles.stage}
            data-state={i < stage ? "past" : i === stage ? "current" : "next"}
            aria-current={i === stage ? "step" : undefined}
          >
            <span className={styles.stageIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                {ended && i === 4 ? ICON_ENDED : ICONS[i]}
              </svg>
            </span>
            <span className={styles.stageLabel}>{label}</span>
          </li>
        ))}
      </ol>

      {detail && <p className={styles.detail}>{detail}</p>}
      <p className={styles.srOnly} aria-live="polite">
        {`Step ${stage + 1} of 5: ${labels[stage]}.`}
        {detail ? ` ${detail}` : ""}
      </p>

      {live && nowServingNumber && (
        <p className={styles.nowServing}>
          Now serving{" "}
          <span translate="no" className={styles.nowCode}>
            <RolodexWord words={[nowServingNumber]} />
          </span>
        </p>
      )}
    </div>
  );
}
