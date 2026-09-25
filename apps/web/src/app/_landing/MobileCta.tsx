"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import styles from "../page.module.css"

// Phones only (hidden from 768px in CSS). It slides up once the hero's own
// buttons have scrolled off the top, so the two pairs never show together,
// and stays inert (unfocusable, unread) while it is tucked away.
export function MobileCta({ watch }: { watch: string }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const target = document.getElementById(watch)
    if (!target) return
    const io = new IntersectionObserver(([entry]) =>
      setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    )
    io.observe(target)
    return () => io.disconnect()
  }, [watch])

  return (
    <>
      <div className={styles.ctaSpacer} aria-hidden="true" />
      <nav aria-label="Quick actions" className={styles.ctaBar} data-shown={shown || undefined} inert={!shown}>
        <Link href="/login?next=/my" className={`${styles.btn} ${styles.btnAccent}`}>
          Take a token
        </Link>
        <a href="#status" className={`${styles.btn} ${styles.btnOutline}`}>
          Check status
        </a>
      </nav>
    </>
  )
}
