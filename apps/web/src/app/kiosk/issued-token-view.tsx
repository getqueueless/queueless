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

const PRINT_SIZES: { value: PrintSize; name: string; spec: string }[] = [
  { value: "thermal", name: "Thermal roll", spec: "80 mm" },
  { value: "a4", name: "Office printer", spec: "A4" },
]

// The big glyph is the token CODE, not its bare number: the slip, the TV
// board and the patient's status page all say "PED-006", so the person
// handing over the slip reads the same thing the board will call.
export function IssuedTokenView({
  code,
  serviceName,
  children,
}: {
  code: string
  serviceName: string
  children: ReactNode
}) {
  const [printSize, setPrintSize] = useState<PrintSize>("thermal")

  return (
    <div className={styles.issued}>
      <style>{PAGE_RULE[printSize]}</style>

      <div className={`${styles.tokenPanel} ${styles.noPrint}`}>
        <p className={styles.tokenNumber} translate="no">
          {code}
        </p>
        <p className={styles.issuedLabel}>{serviceName}</p>
        <p className={styles.hint}>Print this slip and hand it to the patient.</p>
      </div>

      <div className={styles.printArea}>{children}</div>

      <div className={`${styles.controls} ${styles.noPrint}`}>
        <fieldset className={styles.printSizeToggle}>
          <legend className={styles.visuallyHidden}>Printer paper size</legend>
          {PRINT_SIZES.map((size) => (
            <label key={size.value} className={styles.printSizeOption}>
              <input
                type="radio"
                name="print_size"
                checked={printSize === size.value}
                onChange={() => setPrintSize(size.value)}
              />
              <span className={styles.printSizeName}>{size.name}</span>
              <span className={styles.printSizeSpec}>{size.spec}</span>
            </label>
          ))}
        </fieldset>

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
