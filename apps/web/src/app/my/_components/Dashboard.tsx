import { Suspense } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import { AnimatedHeading } from "@/components/motion/AnimatedHeading"

import { ClaimTicketForm } from "../ClaimTicketForm"
import { DoctorActions } from "../DoctorActions"
import styles from "../my.module.css"
import { loadActiveToken, type ActiveToken, type Org } from "./data"
import { dayKey, firstName } from "./format"
import { ArrowIcon, TicketIcon } from "./icons"
import { TokenCard } from "./TokenCard"
import t from "./TokenCard.module.css"
import ui from "./ui.module.css"

type DashboardProps = {
  supabase: SupabaseClient
  userId: string | null
  fullName: string | null
  org: Org
  now: Date
  doctors: { id: string; service_id: string; name: string; specialty: string; fee_inr: number }[]
}

// The /my body. page.tsx does the auth reads and hands them in. Every data
// read starts here at once and streams into its own <Suspense>, so the hero
// paints immediately and each section swaps its skeleton for real rows as
// they land.
export function Dashboard({ supabase, userId, fullName, org, now, doctors }: DashboardProps) {
  const name = firstName(fullName)
  const today = now.toLocaleDateString("en-US", {
    timeZone: org.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  const token = userId ? loadActiveToken(supabase, userId) : Promise.resolve(null)

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="welcome">
        <div className={styles.greeting}>
          <AnimatedHeading
            as="h1"
            id="welcome"
            onDark
            lead="Welcome back,"
            accent={name ?? "there"}
            className={styles.heroTitle}
          />
          <p className={styles.heroMeta}>
            <time dateTime={dayKey(now, org.timeZone)}>{today}</time>
            <span aria-hidden="true"> · </span>
            {org.name}
          </p>
        </div>

        <div className={styles.heroCard}>
          <Suspense fallback={<TokenSkeleton />}>
            <TokenSlot token={token} />
          </Suspense>
        </div>
      </section>

      <div className={styles.body}>
        <section className={styles.full} aria-labelledby="claim-heading">
          <h2 id="claim-heading" className={styles.sectionTitle}>
            Claim a paper ticket
          </h2>
          <ClaimTicketForm />
        </section>

        <div id="doctors" className={styles.full}>
          <DoctorActions doctors={doctors} />
        </div>
      </div>
    </div>
  )
}

async function TokenSlot({ token }: { token: Promise<ActiveToken | null> }) {
  const active = await token
  return active ? <TokenCard initial={active} /> : <NoToken />
}

function NoToken() {
  return (
    <article className={`${t.card} ${t.empty}`} aria-labelledby="no-token">
      <div className={t.emptyArt}>
        <TicketIcon size={44} />
      </div>
      <h2 id="no-token" className={t.emptyTitle}>
        No active token
      </h2>
      <p className={t.emptyText}>
        Pick a doctor below to join today&apos;s queue. You can follow your place in line from here.
      </p>
      <a href="#doctors" className={t.bigCta}>
        Take a token
        <ArrowIcon />
      </a>
    </article>
  )
}

function TokenSkeleton() {
  return (
    <div className={t.card} role="status">
      <span className={ui.srOnly}>Loading your token</span>
      <span className={`${ui.skel} ${t.skelCode}`} />
      <span className={`${ui.skel} ${t.skelLine}`} />
      <span className={`${ui.skel} ${t.skelRing}`} />
      <span className={`${ui.skel} ${t.skelCta}`} />
    </div>
  )
}
