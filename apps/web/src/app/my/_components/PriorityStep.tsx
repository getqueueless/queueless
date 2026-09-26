"use client"

import { useEffect, useId, useRef, useState } from "react"

import { CloseIcon } from "./icons"
import styles from "./PriorityStep.module.css"
import q from "./QuickActions.module.css"

export type Lane = "normal" | "senior" | "pregnant" | "emergency"
export type PriorityChoice = { lane: Lane; note: string }

export const LANE_LABEL: Record<Exclude<Lane, "normal">, string> = {
  senior: "Senior citizen",
  pregnant: "Pregnant",
  emergency: "Emergency",
}

const NOTE_MAX = 80

/**
 * "Do you need priority?", asked before a token or slot is held. The choice is
 * a request: staff confirm it at the counter. Opens as a native modal while
 * `open` is true; Esc, the backdrop and Back all call onCancel.
 */
export function PriorityStep({
  open,
  seniorAuto,
  actionLabel,
  onCancel,
  onContinue,
}: {
  open: boolean
  /** Profile date of birth says 60 or over: Senior starts selected. */
  seniorAuto: boolean
  actionLabel: string
  onCancel: () => void
  onContinue: (choice: PriorityChoice) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Senior is never requested: start_paid_booking/appointment (0072) apply it
  // from the profile's date of birth and it wins over any other choice.
  const [lane, setLane] = useState<Lane>(seniorAuto ? "senior" : "normal")
  const [note, setNote] = useState("")
  const name = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const options: { value: Lane; title: string; hint: string; disabled: boolean }[] = [
    { value: "normal", title: "None", hint: "Join the normal queue", disabled: seniorAuto },
    {
      value: "senior",
      title: "Senior citizen (60+)",
      hint: seniorAuto ? "Auto from your date of birth" : "Applied automatically when your profile's date of birth says 60+",
      disabled: !seniorAuto,
    },
    { value: "pregnant", title: "Pregnant", hint: "At any stage", disabled: seniorAuto },
    { value: "emergency", title: "Emergency", hint: "An urgent medical need", disabled: seniorAuto },
  ]

  return (
    <dialog
      ref={ref}
      className={q.dialog}
      aria-labelledby={`${name}-title`}
      onClose={onCancel}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close()
      }}
    >
      <form
        className={q.sheet}
        onSubmit={(e) => {
          e.preventDefault()
          onContinue({ lane, note: note.trim() })
        }}
      >
        <div className={q.sheetHead}>
          <h2 id={`${name}-title`} className={q.sheetTitle}>
            Do you need priority?
          </h2>
          <button type="button" className={q.close} onClick={() => ref.current?.close()} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <fieldset className={styles.options}>
          <legend className={styles.legend}>Choose one</legend>
          {options.map((o) => (
            <label key={o.value} className={styles.option} data-lane={o.value} data-disabled={o.disabled || undefined}>
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={lane === o.value}
                disabled={o.disabled}
                onChange={() => setLane(o.value)}
              />
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>{o.title}</span>
                <span className={styles.optionHint}>{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {lane === "emergency" && (
          <p className={styles.emergency} role="note">
            For a medical emergency go straight to the Emergency department; staff will verify at the counter.
          </p>
        )}

        {lane !== "normal" && (
          <>
        <label className={styles.noteLabel} htmlFor={`${name}-note`}>
          Note for staff <span className={styles.optional}>(optional)</span>
        </label>
        <input
          id={`${name}-note`}
          className={styles.note}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. using a wheelchair"
          aria-describedby={`${name}-count`}
        />
        <p id={`${name}-count`} className={styles.count}>
          {note.length}/{NOTE_MAX}
        </p>
          </>
        )}

        <p className={styles.fine}>
          Priority is confirmed by staff at the counter. False claims move you back to the normal queue.
        </p>

        <div className={styles.actions}>
          <button type="button" className={styles.back} onClick={() => ref.current?.close()}>
            Back
          </button>
          <button type="submit" className={styles.go}>
            {actionLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
