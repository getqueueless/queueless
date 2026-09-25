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

// The Android card's download, gated on a published build: until
// /android/version.json carries a versionCode the APK URL would 404, so the
// card shows a disabled "publishing" button and no QR, and re-checks every
// 30s until the first build lands, then swaps in the real link on its own.
export function AndroidDownload({ apk, versionUrl, qr }: { apk: string; versionUrl: string; qr: string }) {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (version) return
    let cancelled = false
    const check = () =>
      fetch(versionUrl, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { versionCode?: unknown; versionName?: unknown } | null) => {
          if (!cancelled && typeof data?.versionCode === "number") {
            setVersion(typeof data.versionName === "string" ? data.versionName : String(data.versionCode))
          }
        })
        .catch(() => {})
    check()
    const id = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [version, versionUrl])

  if (!version) {
    return (
      <button type="button" disabled className={`${styles.btn} ${styles.btnAccent} ${styles.appButton}`}>
        Android build publishing…
      </button>
    )
  }
  return (
    <>
      <figure className={styles.appQr}>
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
        <figcaption>Scan with your Android phone</figcaption>
      </figure>
      <a href={apk} download className={`${styles.btn} ${styles.btnAccent} ${styles.appButton}`}>
        Download for Android
      </a>
      <p className={styles.appVersion}>Version {version}</p>
    </>
  )
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
