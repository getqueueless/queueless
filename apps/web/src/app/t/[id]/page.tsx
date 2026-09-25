import type { Metadata } from "next"

import { createClient } from "@/lib/supabase/server"
import {
  countOpenCounters,
  countTokensAhead,
  fetchCounter,
  fetchService,
  fetchToken,
  isUuid,
} from "./data"
import { fetchPrediction, mapServiceToPredictSlug } from "./predict"
import { StatusView } from "./status-view"
import styles from "./status.module.css"

export const metadata: Metadata = {
  title: "Your token — Queueless",
}

function NotFoundCard() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Token not found</h1>
        <p className={styles.subtitle}>
          This link may have expired, or the token was already cleared for the day. Check the
          QR code on your slip and try again, or ask the counter for help.
        </p>
      </div>
    </main>
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
      const slug = mapServiceToPredictSlug(service)
      if (slug) {
        const countersOpen = await countOpenCounters(supabase, token.service_id)
        const prediction = await fetchPrediction(slug, queueAhead, countersOpen)
        if (prediction) {
          predictedWaitMinutes = prediction.predictedWaitMinutes
          predictedIsFallback = prediction.fallback
        }
      }
    }
  }

  return (
    <StatusView
      tokenId={id}
      initialToken={token}
      service={service}
      initialCounter={counter}
      initialQueueAhead={queueAhead}
      initialPredictedWaitMinutes={predictedWaitMinutes}
      initialPredictedIsFallback={predictedIsFallback}
    />
  )
}
