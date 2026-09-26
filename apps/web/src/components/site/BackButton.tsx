"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import styles from "./BackButton.module.css"

// Pages where Back would be wrong: home is the top, the TV board and kiosk are
// full-screen public terminals nobody should navigate away from.
function hiddenOn(path: string) {
  return path === "/" || path.startsWith("/display") || path.startsWith("/kiosk") || path.startsWith("/auth")
}

// Where Back goes when there's no in-app history (a link opened in a new tab,
// a QR scan): one level up, with the few leaf routes that have no index page.
function parentOf(path: string) {
  const parts = path.split("/").filter(Boolean)
  if (parts[0] === "pay") return "/my"
  if (parts[0] === "t" || parts[0] === "slip" || parts.length <= 1) return "/"
  return "/" + parts.slice(0, -1).join("/")
}

// Module scope, not state: each page's header mounts its own button, so the
// "has this tab navigated inside the site yet" fact has to outlive them.
let firstPath: string | null = null
let navigated = false

// Below whatever sticky strip is pinned to the top (the live-token bar), else 12px.
function floatTop() {
  const bar = document.querySelector("[data-sticky-top]")
  const r = bar?.getBoundingClientRect()
  return r && r.top <= 0 && r.bottom > 0 ? r.bottom + 8 : 12
}

const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export function BackButton({ className, variant }: { className?: string; variant?: "admin" }) {
  const pathname = usePathname()
  const router = useRouter()
  const ref = useRef<HTMLButtonElement>(null)
  // Once the header's own button scrolls off screen, a pinned copy takes over
  // in the top-left corner, so Back is reachable from every part of the page.
  const [floating, setFloating] = useState<number | null>(null)

  useEffect(() => {
    if (firstPath === null) firstPath = pathname
    else if (pathname !== firstPath) navigated = true
  }, [pathname])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setFloating(el.getBoundingClientRect().bottom < 0 ? floatTop() : null)
      })
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [pathname])

  if (hiddenOn(pathname)) return null

  const goBack = () => (navigated ? router.back() : router.push(parentOf(pathname) as "/"))

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className ? `${styles.back} ${className}` : styles.back}
        onClick={goBack}
        aria-label="Go back"
      >
        <Chevron />
        <span className={styles.label}>Back</span>
      </button>
      {floating !== null && (
        <button
          type="button"
          className={styles.float}
          data-variant={variant}
          style={{ top: floating }}
          onClick={goBack}
          aria-label="Go back"
        >
          <Chevron />
          <span className={styles.label}>Back</span>
        </button>
      )}
    </>
  )
}
