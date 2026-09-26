"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import styles from "./BackButton.module.css"

// Pages where a floating Back would be wrong: home is the top, the TV board
// and kiosk are full-screen public terminals nobody should navigate away from.
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

export function BackButton() {
  const pathname = usePathname()
  const router = useRouter()
  const firstPath = useRef(pathname)
  // Lives in the root layout, so it survives client navigations: once the path
  // has changed in this tab, router.back() stays inside the site.
  const [hasHistory, setHasHistory] = useState(false)

  useEffect(() => {
    if (pathname !== firstPath.current) setHasHistory(true)
  }, [pathname])

  if (hiddenOn(pathname)) return null

  return (
    <button
      type="button"
      className={styles.back}
      data-lift={pathname.startsWith("/pay") || undefined}
      onClick={() => (hasHistory ? router.back() : router.push(parentOf(pathname) as "/"))}
      aria-label="Go back"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Back
    </button>
  )
}
