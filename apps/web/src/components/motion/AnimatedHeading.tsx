"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./AnimatedHeading.module.css";

type AnimatedHeadingProps = {
  /** Heading level. Pick it for the page outline, not the look. */
  as?: "h1" | "h2" | "h3";
  /** Words in ink ("Check your"). */
  lead: string;
  /** Words in cyan ("status"). */
  accent: string;
  /** On a slate section: white lead. */
  onDark?: boolean;
  align?: "start" | "center";
  /** For aria-labelledby on the section it titles. */
  id?: string;
  className?: string;
};

// TwoToneHeading, split into letters that rise out of a blur the first time
// the heading scrolls into view. A heading already on screen when the page
// loads stays put (it never blinks out), and with no JS nothing is hidden:
// only the observer's first "not visible" report arms the entrance.
export function AnimatedHeading({
  as: Tag = "h3",
  lead,
  accent,
  onDark = false,
  align = "start",
  id,
  className,
}: AnimatedHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<"rest" | "armed" | "in">("rest");

  useEffect(() => {
    let first = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!first) setPhase("in");
          io.disconnect();
        } else if (first) {
          setPhase("armed");
        }
        first = false;
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  let n = 0;
  const letters = (text: string) =>
    text.split(" ").map((word, w) => (
      <Fragment key={w}>
        {w > 0 && " "}
        <span className={styles.word}>
          {Array.from(word, (ch) => (
            <span key={n} className={styles.letter} style={{ "--i": n++ } as CSSProperties}>
              {ch}
            </span>
          ))}
        </span>
      </Fragment>
    ));

  const cls = [styles.heading, onDark && styles.onDark, align === "center" && styles.center, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag ref={ref} id={id} aria-label={`${lead} ${accent}`} data-phase={phase} className={cls}>
      <span aria-hidden="true">{letters(lead)}</span>{" "}
      <span aria-hidden="true" className={styles.accent}>
        {letters(accent)}
      </span>
    </Tag>
  );
}
