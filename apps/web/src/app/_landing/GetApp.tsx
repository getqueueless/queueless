import { AnimatedHeading } from "@/components/motion/AnimatedHeading"
import { tokenQrSvg } from "@/lib/qr"

import styles from "../page.module.css"
import { AndroidDownload, CopyButton, PlatformCards } from "./AppExtras"

const APK = "https://lpu.lol/android/queueless.apk"
const APK_VERSION = "/android/version.json" // same origin as the page
const IOS_PAGE = "https://lpu.lol/ios"
const IOS_SOURCE = "https://lpu.lol/ios/source.json"

// Desktop: Android and iPhone side by side, each with a QR to scan from the
// phone. On a phone the QR is pointless, so it hides, and only the card for
// that phone's platform stays (both when the platform is unknown).
export async function GetApp() {
  const [androidQr, iosQr] = await Promise.all([tokenQrSvg(APK), tokenQrSvg(IOS_PAGE)])
  return (
    <section id="get-app" aria-labelledby="app-title" className={styles.getApp}>
      <AnimatedHeading as="h2" id="app-title" lead="Get the" accent="app" align="center" />
      <p className={styles.sectionIntro}>Your token and its live place in line, on your phone.</p>

      <PlatformCards>
        <article className={styles.appCard} data-os="android" aria-labelledby="app-android">
          <h3 id="app-android" className={styles.appName}>
            Android
          </h3>
          <AndroidDownload apk={APK} versionUrl={APK_VERSION} qr={androidQr} />
          <p className={styles.appNote2}>Allow “Install unknown apps” when your phone asks.</p>
        </article>

        <article className={styles.appCard} data-os="ios" aria-labelledby="app-ios">
          <h3 id="app-ios" className={styles.appName}>
            iPhone
          </h3>
          <figure className={styles.appQr}>
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iosQr }} />
            <figcaption>Scan with your iPhone</figcaption>
          </figure>
          <ol className={styles.appSteps}>
            <li>
              Install <a href="https://sidestore.io">SideStore</a>.
            </li>
            <li>
              Add this source:
              <span className={styles.sourceRow}>
                <code translate="no">{IOS_SOURCE}</code>
                <CopyButton text={IOS_SOURCE} />
              </span>
            </li>
            <li>Install Queueless from it.</li>
          </ol>
          <a
            href={`sidestore://source?url=${IOS_SOURCE}`}
            className={`${styles.btn} ${styles.btnAccent} ${styles.appButton}`}
          >
            Add to SideStore
          </a>
        </article>
      </PlatformCards>
    </section>
  )
}
