"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import styles from "../page.module.css"
import { extractTokenId } from "./token-id"

type Detect = (video: HTMLVideoElement) => Promise<string | null>
type NativeDetector = new (options: { formats: string[] }) => {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

// Native BarcodeDetector (Chrome on Android, ChromeOS, macOS) where it
// exists; otherwise jsQR, imported only once the scanner opens (iOS Safari,
// Firefox, desktop Linux/Windows Chrome), on a frame scaled to 480px.
async function makeDetector(): Promise<Detect> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector
  if (Native) {
    try {
      const detector = new Native({ formats: ["qr_code"] })
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
    } catch {}
  }
  const jsQR = (await import("jsqr")).default
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  return async (video) => {
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight, 1))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    if (!ctx || !canvas.width || !canvas.height) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(frame.data, frame.width, frame.height)?.data ?? null
  }
}

const NO_CAMERA_API = "This browser can’t open the camera. Type the link instead."
// Missing on plain http and in some in-app browsers, whatever the types say.
const hasCamera = () => typeof navigator.mediaDevices?.getUserMedia === "function"

// "Scan QR" next to Check status: a camera sheet that reads the slip's QR and
// opens its /t/<id> page. The camera stops on a hit, on Close or Escape (the
// native <dialog> cancel), and when the component unmounts.
export function ScanQr() {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !hasCamera()) return
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    const stop = () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (media) => {
        stream = media
        if (stopped) return stop()
        const el = video.current!
        el.srcObject = media
        await el.play().catch(() => {})
        const detect = await makeDetector()
        const tick = async () => {
          if (stopped) return
          const text = el.readyState >= 2 ? await detect(el).catch(() => null) : null
          if (stopped) return
          if (text) {
            const id = extractTokenId(text)
            if (id) {
              stop()
              dialog.current?.close()
              router.push(`/t/${id}`)
              return
            }
            setMessage("That QR isn’t a Queueless slip. Scan the code printed on your token slip.")
          }
          timer = window.setTimeout(tick, 200)
        }
        tick()
      })
      .catch((error: DOMException) => {
        setMessage(
          error.name === "NotAllowedError" || error.name === "SecurityError"
            ? "Allow camera, or type the link."
            : "No camera found. Type the link instead.",
        )
      })

    return stop
  }, [open, router])

  function openScanner() {
    setMessage(hasCamera() ? null : NO_CAMERA_API)
    dialog.current?.showModal()
    setOpen(true)
  }

  return (
    <>
      <button type="button" onClick={openScanner} className={`${styles.btn} ${styles.btnOutline}`}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className={styles.scanIcon}>
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" />
        </svg>
        Scan QR
      </button>
      <dialog ref={dialog} aria-labelledby="scan-title" className={styles.scanner} onClose={() => setOpen(false)}>
        <div className={styles.scannerHead}>
          <h2 id="scan-title" className={styles.scannerTitle}>
            Scan your slip
          </h2>
          <button
            type="button"
            aria-label="Close scanner"
            className={styles.scannerClose}
            onClick={() => dialog.current?.close()}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.viewfinder}>
          <video ref={video} muted playsInline className={styles.scannerVideo} />
          <span className={styles.scanFrame} aria-hidden="true" />
        </div>
        <p role="status" className={styles.scanMessage}>
          {message ?? "Point the camera at the QR code on your slip."}
        </p>
      </dialog>
    </>
  )
}
