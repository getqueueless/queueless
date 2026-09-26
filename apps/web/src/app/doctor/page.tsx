import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/auth/SignOutButton"
import { Logo, LogoMark } from "@/components/brand/Logo"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { createClient } from "@/lib/supabase/server"
import { ACTIVE_TOKEN_STATUSES, type ProfileRow, type TokenRow } from "../counter/types"
import styles from "../counter/counter.module.css"
import { DoctorDesk, type DeskInfo } from "./doctor-desk"

export const metadata: Metadata = { title: "Doctor desk" }

const TOKEN_COLUMNS =
  "id, org_id, service_id, service_day, number, code, lane, status, patient_id, walk_in_label, counter_id, recall_count, called_at, serving_at"

function TopBar() {
  return (
    <header className={styles.topbar} data-surface="slate">
      <a href="#main" className={styles.skipLink}>
        Skip to desk
      </a>
      <div className={styles.topbarInner}>
        <Logo size={22} />
        <span className={styles.topbarDivider} aria-hidden="true" />
        <span className={styles.topbarLabel}>Doctor desk</span>
        <div className={styles.topbarActions}>
          <a href="/counter" className={styles.signOut}>
            Counter
          </a>
          <SignOutButton className={styles.signOut} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

// The /counter console's data and RPCs, laid out for a doctor (or their
// assistant) on a PC: one big current patient, big keyed buttons, who is
// next, and today's numbers. Staff and admin only, checked here on the server.
export default async function DoctorPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/doctor")

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, org_id, role, full_name")
    .eq("id", user.id)
    .maybeSingle()
  const profile = (profileData as ProfileRow | null) ?? null
  if (!profile || (profile.role !== "staff" && profile.role !== "admin")) redirect("/")

  const { data: counterData } = await supabase
    .from("counters")
    .select("id, org_id, name, state, doctor_id")
    .eq("staff_id", user.id)
    // A staff user can own several desks: the doctor-bound one first, then by name.
    .order("doctor_id", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(1)
    .maybeSingle()
  const counter = counterData as (DeskInfo["counter"] & { doctor_id: string | null }) | null

  if (!counter) {
    return (
      <div className={styles.page}>
        <TopBar />
        <main id="main">
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <LogoMark size={26} />
            </span>
            <h1 className={styles.emptyTitle}>No desk assigned</h1>
            <p className={styles.emptyBody}>
              Your account ({profile.full_name ?? user.email}) isn’t linked to a counter yet. Ask an admin to
              assign you one.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const [currentRes, servicesRes, doctorRes] = await Promise.all([
    supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .eq("counter_id", counter.id)
      .in("status", ACTIVE_TOKEN_STATUSES)
      .limit(1)
      .maybeSingle(),
    supabase.from("counter_services").select("service_id, services(name)").eq("counter_id", counter.id),
    counter.doctor_id
      ? supabase.from("doctors").select("id, name, room, specialty").eq("id", counter.doctor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const links = (servicesRes.data ?? []) as unknown as { service_id: string; services: { name: string } | null }[]
  const desk: DeskInfo = {
    counter: { id: counter.id, org_id: counter.org_id, name: counter.name, state: counter.state },
    serviceIds: links.map((l) => l.service_id),
    serviceLabel: links.map((l) => l.services?.name).filter(Boolean).join(" · ") || "No service assigned",
    doctor: (doctorRes.data as DeskInfo["doctor"]) ?? null,
    isAdmin: profile.role === "admin",
  }

  return (
    <div className={styles.page}>
      <TopBar />
      <main id="main">
        <DoctorDesk desk={desk} initialToken={(currentRes.data as TokenRow | null) ?? null} />
      </main>
    </div>
  )
}
