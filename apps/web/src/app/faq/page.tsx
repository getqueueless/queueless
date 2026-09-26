import type { Metadata } from "next"

import { AnimatedHeading } from "@/components/motion/AnimatedHeading"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { FaqClient } from "./FaqClient"
import { fetchFaq } from "./help-api"
import styles from "./faq.module.css"

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about tokens, payments, refunds, the app, and how WaitWise keeps your data safe.",
}

export default async function FaqPage() {
  const items = await fetchFaq()
  return (
    <>
      <PublicHeader />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <AnimatedHeading as="h1" lead="Questions," accent="answered" onDark align="center" />
        </div>
        <div className={styles.container}>
          {items ? (
            <FaqClient items={items} />
          ) : (
            <p className={styles.unavailable} role="status">
              FAQ unavailable, try again in a moment.
            </p>
          )}
        </div>
      </main>
      <PublicFooter />
    </>
  )
}
