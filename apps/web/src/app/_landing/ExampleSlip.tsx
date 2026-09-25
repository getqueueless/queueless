import { toString as qrToString } from "qrcode"

import { Logo } from "@/components/brand/Logo"

import styles from "../page.module.css"

// A picture of the printed slip (kiosk/token-slip.tsx), so a patient can match
// it to the one in their hand and see where the link is. The QR is real but
// only says "Example slip only", so scanning it can't open anybody's token.
// Short text + low error correction keeps it a sparse 21x21 at 96px.
const QR = qrToString("Example slip only", { type: "svg", margin: 0, errorCorrectionLevel: "L" })

// Two fixed lines of 27, broken after a hyphen, so the wrap holds at any zoom.
const EXAMPLE_URL = ["https://lpu.lol/t/7f3c9a2e-", "41d0-4b6e-9a57-2c8e5d1f0b36"]

export async function ExampleSlip() {
  const qr = await QR

  return (
    <figure className={styles.slipFigure}>
      <div
        role="img"
        aria-label="Example token slip for General OPD, token OPD-042. The QR code is in the middle and the link to type is printed under it."
        className={styles.slip}
      >
        <Logo size={14} />
        <span className={styles.slipService}>General OPD</span>
        <span className={styles.slipNumber} translate="no">
          OPD-042
        </span>
        <span className={styles.slipMeta}>Token #42</span>
        <span className={styles.slipCut} />
        <span className={styles.slipQrWrap}>
          <span className={styles.slipQr} dangerouslySetInnerHTML={{ __html: qr }} />
          <span className={`${styles.callout} ${styles.calloutQr}`}>Scan this</span>
        </span>
        <span className={styles.slipHint}>Scan to track your turn</span>
        <span className={styles.slipUrl} translate="no">
          {EXAMPLE_URL.map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span className={`${styles.callout} ${styles.calloutUrl}`}>Or type this</span>
        </span>
      </div>
    </figure>
  )
}
