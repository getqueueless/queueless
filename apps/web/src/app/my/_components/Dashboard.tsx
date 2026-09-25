import Link from "next/link"
import { Suspense } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import { AnimatedHeading } from "@/components/motion/AnimatedHeading"

import { DoctorActions, DoctorsSkeleton } from "../DoctorActions"
import styles from "../my.module.css"
import { Appointments } from "./Appointments"
import {
  loadActiveToken,
  loadAppointments,
  loadDepartments,
  loadDoctors,
  loadRecentVisits,
  type ActiveToken,
  type Appointment,
  type DashboardDoctor,
  type Department,
  type Org,
  type Visit,
} from "./data"
import { dayKey, firstName, TOKEN_STATUS } from "./format"
import h from "./History.module.css"
import { ArrowIcon, PhoneOffIcon, TicketIcon } from "./icons"
import { LiveNow, LiveNowSkeleton } from "./LiveNow"
import { ClaimButton, ClaimDialog, QuickActions } from "./QuickActions"
import { TokenCard } from "./TokenCard"
import t from "./TokenCard.module.css"
import ui from "./ui.module.css"

type DashboardProps = {
  supabase: SupabaseClient
  userId: string | null
  fullName: string | null
  org: Org
  now: Date
}

// The /my body. page.tsx does the auth reads and hands them in. Every data
// read starts here at once and streams into its own <Suspense>, so the hero
// paints immediately and each section swaps its skeleton for real rows as
// they land.
export function Dashboard({ supabase, userId, fullName, org, now }: DashboardProps) {
  const name = firstName(fullName)
  const today = now.toLocaleDateString("en-US", {
    timeZone: org.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  const token = userId ? loadActiveToken(supabase, userId) : Promise.resolve(null)
  const departments = loadDepartments(supabase, org.id)
  const doctors = loadDoctors(supabase, org.id, org.timeZone, now)
  const appointments = userId ? loadAppointments(supabase, userId, org.timeZone, now) : Promise.resolve([])
  const visits = userId ? loadRecentVisits(supabase, userId, org.timeZone) : Promise.resolve([])

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

        <div className={styles.heroActions}>
          <QuickActions />
        </div>
      </section>

      <div className={styles.body}>
        <section className={styles.full} aria-labelledby="live-now">
          <div className={ui.sectionHead}>
            <AnimatedHeading as="h2" id="live-now" lead="Live" accent="now" />
            <p className={ui.aside}>
              <span className={ui.liveDot} aria-hidden="true" />
              Queue lengths as they change, waits from our prediction model
            </p>
          </div>
          <Suspense fallback={<LiveNowSkeleton />}>
            <LiveSlot departments={departments} day={dayKey(now, org.timeZone)} />
          </Suspense>
        </section>

        <section id="doctors" className={styles.full} aria-labelledby="doctors-title">
          <div className={ui.sectionHead}>
            <AnimatedHeading as="h2" id="doctors-title" lead="Find a" accent="doctor" />
          </div>
          <Suspense fallback={<DoctorsSkeleton />}>
            <DoctorsSlot doctors={doctors} />
          </Suspense>
        </section>

        <section className={styles.wide} aria-labelledby="appointments-title">
          <div className={ui.sectionHead}>
            <AnimatedHeading as="h2" id="appointments-title" lead="Upcoming" accent="appointments" />
            <details className={h.policy}>
              <summary>Cancellation &amp; refund policy</summary>
              <div className={h.policyBody}>
                <ul>
                  <li>Cancel a booked appointment any time before it starts, from this list.</li>
                  <li>An unpaid hold costs nothing: cancel it here, or skip paying and it is released after 10 minutes.</li>
                  <li>Online payments are refunded automatically if the doctor goes on leave that day.</li>
                  <li>Any other refund is approved by the hospital. Ask at reception.</li>
                </ul>
              </div>
            </details>
          </div>
          <div className={h.panel}>
            <Suspense fallback={<RowsSkeleton label="Loading your appointments" />}>
              <AppointmentsSlot appointments={appointments} userId={userId} timeZone={org.timeZone} />
            </Suspense>
          </div>
        </section>

        <section className={styles.narrow} aria-labelledby="visits-title">
          <div className={ui.sectionHead}>
            <AnimatedHeading as="h2" id="visits-title" lead="Recent" accent="visits" />
          </div>
          <div className={h.panel}>
            <Suspense fallback={<RowsSkeleton label="Loading your visits" />}>
              <VisitsSlot visits={visits} />
            </Suspense>
          </div>
        </section>

        <section className={`${styles.full} ${h.help}`} aria-labelledby="help-title">
          <span className={h.helpIcon}>
            <PhoneOffIcon size={30} />
          </span>
          <div className={h.helpText}>
            <h2 id="help-title" className={h.helpTitle}>
              At the hospital without a phone?
            </h2>
            <p className={h.helpBody}>Ask reception for a paper ticket and claim it here.</p>
          </div>
          <ClaimButton className={h.helpButton}>Claim a ticket</ClaimButton>
        </section>
      </div>

      <ClaimDialog />
    </div>
  )
}

async function LiveSlot({ departments, day }: { departments: Promise<Department[]>; day: string }) {
  return <LiveNow departments={await departments} day={day} />
}

async function DoctorsSlot({ doctors }: { doctors: Promise<DashboardDoctor[]> }) {
  return <DoctorActions doctors={await doctors} />
}

async function AppointmentsSlot({
  appointments,
  userId,
  timeZone,
}: {
  appointments: Promise<Appointment[]>
  userId: string | null
  timeZone: string
}) {
  return <Appointments items={await appointments} userId={userId} timeZone={timeZone} />
}

async function VisitsSlot({ visits }: { visits: Promise<Visit[]> }) {
  const rows = await visits
  if (rows.length === 0) {
    return (
      <div className={h.empty}>
        <span className={h.emptyIcon}>
          <TicketIcon />
        </span>
        <p>No visits yet. Your tokens will show up here.</p>
      </div>
    )
  }
  return (
    <ul className={h.list}>
      {rows.map((v) => (
        <li key={v.id}>
          <Link href={`/t/${v.id}`} className={h.visit}>
            <span className={h.code} translate="no">
              {v.code}
            </span>
            <span className={h.primaryLine} translate="no">
              {v.doctor ?? v.service}
            </span>
            <span className={h.visitDate}>
              {v.doctor ? `${v.service}, ` : ""}
              {v.date}
            </span>
            <span className={ui.chip} data-tone={(v.paidStatus ?? TOKEN_STATUS[v.status]).tone}>
              {(v.paidStatus ?? TOKEN_STATUS[v.status]).label}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function RowsSkeleton({ label }: { label: string }) {
  return (
    <div role="status">
      <span className={ui.srOnly}>{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className={h.skelRow} aria-hidden="true">
          <span className={`${ui.skel} ${h.skelTile}`} />
          <span className={`${ui.skel} ${h.skelLines}`} />
        </div>
      ))}
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
