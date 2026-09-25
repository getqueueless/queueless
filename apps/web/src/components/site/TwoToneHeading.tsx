import styles from "./TwoToneHeading.module.css";

type TwoToneHeadingProps = {
  /** Heading level. Pick it for the page outline, not the look: the style is the same at every level. */
  as?: "h1" | "h2" | "h3";
  /** Words in ink ("Book"). */
  lead: string;
  /** Words in cyan ("appointment"). */
  accent: string;
  /** On a slate section: white lead, brand-cyan accent. */
  onDark?: boolean;
  align?: "start" | "center";
  /** For aria-labelledby on the section it titles. */
  id?: string;
  className?: string;
};

// MedWin's "BOOK APPOINTMENT" section title. Case is set in CSS, so pass
// normal-case text and screen readers read words, not letters.
export function TwoToneHeading({
  as: Tag = "h2",
  lead,
  accent,
  onDark = false,
  align = "start",
  id,
  className,
}: TwoToneHeadingProps) {
  const cls = [styles.heading, onDark && styles.onDark, align === "center" && styles.center, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag id={id} className={cls}>
      {lead} <span className={styles.accent}>{accent}</span>
    </Tag>
  );
}
