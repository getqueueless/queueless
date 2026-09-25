"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./RolodexWord.module.css";

type RolodexWordProps = {
  /** With `hold`: shown in order, resting on the last. Without: shows the
      last word and flips whenever it changes (live values). Every word
      reserves its width, so the line never reflows. */
  words: string[];
  /** How long each word holds before the next flips up, in ms. */
  hold?: number;
  className?: string;
};

// With `hold`, one pass then rest: three flips at 1.2s finish in about 4.2s,
// inside WCAG 2.2.2's five seconds (the TV board's ripple follows the same
// rule). Screen readers get the resting word once, never the flips.
export function RolodexWord({ words, hold, className }: RolodexWordProps) {
  const [index, setIndex] = useState(0);
  const target = hold ? words[index] : words[words.length - 1];
  const [drum, setDrum] = useState({ shown: target, prev: null as string | null, turn: 0 });

  // Adjust state while rendering when the word changes (React's documented
  // pattern), so the flip starts in the same commit as the new value.
  if (target !== drum.shown) setDrum({ shown: target, prev: drum.shown, turn: drum.turn + 1 });

  useEffect(() => {
    if (!hold || index >= words.length - 1) return;
    const id = setTimeout(() => setIndex(index + 1), hold);
    return () => clearTimeout(id);
  }, [hold, index, words.length]);

  // Once the last flip has landed, the slot shrinks from the widest word to
  // the one it rests on, so a centred line ends truly centred. In em, so it
  // still fits when the font size changes with the viewport.
  const slot = useRef<HTMLSpanElement>(null);
  const resting = Boolean(hold) && index === words.length - 1;
  useEffect(() => {
    const el = slot.current;
    if (!resting || !el) return;
    const id = setTimeout(() => {
      const face = el.lastElementChild as HTMLElement | null;
      const em = parseFloat(getComputedStyle(el).fontSize) || 16;
      if (!face) return;
      el.style.width = `${el.getBoundingClientRect().width / em}em`;
      void el.offsetWidth; // start the transition from the reserved width
      el.style.width = `${face.getBoundingClientRect().width / em}em`;
    }, 650);
    return () => clearTimeout(id);
  }, [resting]);

  return (
    <span className={className ? `${styles.rolodex} ${className}` : styles.rolodex} aria-live="off">
      <span className={styles.srOnly}>{words[words.length - 1]}</span>
      <span ref={slot} className={styles.drum} aria-hidden="true">
        {words.map((word, i) => (
          <span key={`size-${i}`} className={`${styles.face} ${styles.sizer}`}>
            {word}
          </span>
        ))}
        {/* Keyed by turn, so a word coming back remounts and replays. */}
        {drum.prev !== null && (
          <span key={`out-${drum.turn}`} className={styles.face} data-state="out">
            {drum.prev}
          </span>
        )}
        <span key={`in-${drum.turn}`} className={styles.face} data-state={drum.turn ? "in" : undefined}>
          {drum.shown}
        </span>
      </span>
    </span>
  );
}
