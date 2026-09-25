import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { createClient } from "@/lib/supabase/server"
import {
  countOpenCounters,
  countTokensAhead,
  fetchCounter,
  fetchService,
  fetchToken,
  isUuid,
} from "./data"
import { fetchPrediction } from "./predict"
import { StatusView } from "./status-view"
import styles from "./status.module.css"

export const metadata: Metadata = {
  title: "Your token — Queueless",
}

function NotFoundCard() {
  return (
    <>
      <PublicHeader current="status" />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <LogoMark size={300} className={styles.bandMark} />
          <TwoToneHeading as="h1" lead="Token not" accent="found" onDark align="center" />
        </div>
        <div className={styles.card}>
          <p className={styles.subtitle}>
            This link may have expired, or the token was already cleared for the day. Check the
            QR code on your slip and try again, or ask the counter for help.
          </p>
          <Link href="/#status" className={styles.cta}>
            Check your status
          </Link>
        </div>
      </main>
      <PublicFooter />
    </>
  )
}

export default async function TokenStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) {
    return <NotFoundCard />
  }

  const supabase = await createClient()
  const token = await fetchToken(supabase, id)
  if (!token) {
    return <NotFoundCard />
  }

  const [service, counter] = await Promise.all([
    fetchService(supabase, token.service_id),
    token.counter_id ? fetchCounter(supabase, token.counter_id) : Promise.resolve(null),
  ])

  let queueAhead: number | null = null
  let predictedWaitMinutes: number | null = null
  let predictedIsFallback = false

  if (token.status === "waiting") {
    queueAhead = await countTokensAhead(supabase, token)
    if (queueAhead !== null && service) {
      const countersOpen = await countOpenCounters(supabase, token.service_id)
      const prediction = await fetchPrediction(service.id, queueAhead, countersOpen)
      if (prediction) {
        predictedWaitMinutes = prediction.predictedWaitMinutes
        predictedIsFallback = prediction.fallback
      }
    }
  }

  return (
    <>
      <PublicHeader current="status" />
      <StatusView
        tokenId={id}
        initialToken={token}
        service={service}
        initialCounter={counter}
        initialQueueAhead={queueAhead}
        initialPredictedWaitMinutes={predictedWaitMinutes}
        initialPredictedIsFallback={predictedIsFallback}
      />
      <PublicFooter />
    </>
  )
}
