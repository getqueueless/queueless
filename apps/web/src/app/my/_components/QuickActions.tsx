"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { ClaimTicketForm } from "../ClaimTicketForm"
import { CalendarIcon, CloseIcon, ProfileIcon, ScanIcon, TicketIcon } from "./icons"
import styles from "./QuickActions.module.css"

const CLAIM_DIALOG = "claim-ticket"

// A native modal <dialog>: focus trap, Esc, inert page and ::backdrop for free.
// The dialog's focusing steps would land on the close button, so point it at
// the code field instead.
function openClaim() {
  const dialog = document.getElementById(CLAIM_DIALOG) as HTMLDialogElement | null
  dialog?.showModal()
  dialog?.querySelector("input")?.focus()
}

export function ClaimButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={openClaim} aria-haspopup="dialog">
      {children}
    </button>
  )
}

function Tile({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.hint}>{hint}</span>
      </span>
    </>
  )
}

export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className={styles.actions}>
      <ul className={styles.grid}>
        <li>
          <a href="#doctors" className={styles.tile}>
            <Tile icon={<TicketIcon />} title="Take a token" hint="Join a doctor's queue for today" />
          </a>
        </li>
        <li>
          <a href="#doctors" className={styles.tile}>
            <Tile icon={<CalendarIcon />} title="Book appointment" hint="Pick a time with a doctor" />
          </a>
        </li>
        <li>
          <ClaimButton className={styles.tile}>
            <Tile icon={<ScanIcon />} title="Claim paper ticket" hint="Add the slip from reception" />
          </ClaimButton>
        </li>
        <li>
          <Link href="/my/profile" className={styles.tile}>
            <Tile icon={<ProfileIcon />} title="Edit profile" hint="Name, phone and address" />
          </Link>
        </li>
      </ul>
    </nav>
  )
}

export function ClaimDialog() {
  function close() {
    ;(document.getElementById(CLAIM_DIALOG) as HTMLDialogElement | null)?.close()
  }
  return (
    // The dialog box itself has no padding, so a click whose target is the
    // <dialog> element can only be on the backdrop.
    <dialog
      id={CLAIM_DIALOG}
      className={styles.dialog}
      aria-labelledby="claim-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.sheetHead}>
          <h2 id="claim-title" className={styles.sheetTitle}>
            Claim a paper ticket
          </h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <p className={styles.sheetText}>
          Type the code printed on the slip reception gave you. It moves to your account, so you can follow it from this
          phone.
        </p>
        <ClaimTicketForm />
      </div>
    </dialog>
  )
}
