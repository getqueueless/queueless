"use client"

import styles from "./slip.module.css"

export function PrintButton() {
  return (
    <button type="button" className={`${styles.printButton} ${styles.noPrint}`} onClick={() => window.print()}>
      Print
    </button>
  )
}
