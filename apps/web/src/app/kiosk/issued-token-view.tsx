"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"

import styles from "./kiosk.module.css"

type PrintSize = "thermal" | "a4"

// `@page` can't be scoped by a class selector -- it describes the physical
// page, not an element -- so switching paper size at runtime means writing a
// fresh `@page` rule into a `<style>` tag rather than toggling a class.
const PAGE_RULE: Record<PrintSize, string> = {
  thermal: "@page { size: 80mm auto; margin: 4mm; }",
  a4: "@page { size: A4; margin: 12mm; }",
}

export function IssuedTokenView({
  number,
  serviceName,
  children,
}: {
  number: number
  serviceName: string
  children: ReactNode
}) {
  const [printSize, setPrintSize] = useState<PrintSize>("thermal")

  return (
    <div className={styles.issued}>
      <style>{PAGE_RULE[printSize]}</style>

      <div className={`${styles.tokenPanel} ${styles.noPrint}`}>
        <p className={styles.issuedLabel}>{serviceName}</p>
        <p className={styles.tokenNumber}>{number}</p>
        <p className={styles.hint}>Print this slip and hand it to the patient.</p>
      </div>

      <div className={styles.printArea}>{children}</div>

      <div className={`${styles.controls} ${styles.noPrint}`}>
        <div className={styles.printSizeToggle} role="radiogroup" aria-label="Printer paper size">
          <label className={styles.printSizeOption}>
            <input
              type="radio"
              name="print_size"
              checked={printSize === "thermal"}
              onChange={() => setPrintSize("thermal")}
            />
            Thermal roll (80mm)
          </label>
          <label className={styles.printSizeOption}>
            <input
              type="radio"
              name="print_size"
              checked={printSize === "a4"}
              onChange={() => setPrintSize("a4")}
            />
            Office printer (A4)
          </label>
        </div>

        <button type="button" className={styles.submit} onClick={() => window.print()}>
          Print slip
        </button>
        <Link href="/kiosk" className={styles.secondaryLink}>
          New token
        </Link>
      </div>
    </div>
  )
}
