"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"

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

export function BackButton({ className }: { className?: string }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (firstPath === null) firstPath = pathname
    else if (pathname !== firstPath) navigated = true
  }, [pathname])

  if (hiddenOn(pathname)) return null

  return (
    <button
      type="button"
      className={className ? `${styles.back} ${className}` : styles.back}
      onClick={() => (navigated ? router.back() : router.push(parentOf(pathname) as "/"))}
      aria-label="Go back"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span className={styles.label}>Back</span>
    </button>
  )
}
