"use client"

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"

import styles from "../page.module.css"

type Platform = "android" | "ios" | "other"

const noSubscribe = () => () => {}

// iPadOS reports itself as a Mac, so a touch "Mac" counts as iOS.
function detect(): Platform {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return "android"
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios"
  return "other"
}

// Server render (and desktops) show both cards; on a phone the CSS keeps only
// the card for that phone's platform.
export function PlatformCards({ children }: { children: ReactNode }) {
  const platform = useSyncExternalStore(noSubscribe, detect, () => "other" as Platform)
  return (
    <div className={styles.appCards} data-platform={platform}>
      {children}
    </div>
  )
}

// The latest build's versionName from the Android release workflow; nothing
// at all until a build exists or when the fetch fails.
export function AndroidVersion({ url }: { url: string }) {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { versionName?: unknown } | null) => {
        if (!cancelled && typeof data?.versionName === "string") setVersion(data.versionName)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])
  return version ? <p className={styles.appVersion}>Version {version}</p> : null
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])
  return (
    <button
      type="button"
      className={`${styles.btn} ${styles.btnOutline} ${styles.copyButton}`}
      onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  )
}
