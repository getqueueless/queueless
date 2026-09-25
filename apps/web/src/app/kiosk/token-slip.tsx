import { Logo } from "@/components/brand/Logo"
import { tokenQrSvg } from "@/lib/qr"

import styles from "./kiosk.module.css"

// Server Component, no "use client" -- the QR is rendered to SVG server-side
// with the `qrcode` package and inlined as markup, so printing it needs no
// client JS bundle and no image request at all.
export async function TokenSlip({
  statusUrl,
  serviceName,
  number,
  code,
}: {
  statusUrl: string
  serviceName: string
  number: number
  code: string
}) {
  const svg = await tokenQrSvg(statusUrl)

  return (
    <div className={styles.slip}>
      <div className={styles.slipBrand}>
        <Logo size={18} />
      </div>
      <p className={styles.slipService}>{serviceName}</p>
      <p className={styles.slipNumber} translate="no">
        {code}
      </p>
      <p className={styles.slipMeta}>Token #{number}</p>
      <div
        className={styles.slipQr}
        role="img"
        aria-label="QR code for this token's status page"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className={styles.slipHint}>Scan to track your turn</p>
      <p className={styles.slipUrl} translate="no">
        {statusUrl}
      </p>
    </div>
  )
}
