import type { Metadata } from "next"
import { BackButton } from "@/components/site/BackButton"
import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/auth/SignOutButton"
import { Logo, LogoMark } from "@/components/brand/Logo"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { createClient } from "@/lib/supabase/server"
import { ACTIVE_TOKEN_STATUSES, type TokenRow } from "../counter/types"
import styles from "../counter/counter.module.css"
import { DoctorDesk, type DeskInfo } from "./doctor-desk"
import desk from "./doctor.module.css"

export const metadata: Metadata = { title: "Doctor desk" }

const TOKEN_COLUMNS =
  "id, org_id, service_id, service_day, number, code, lane, status, patient_id, walk_in_label, counter_id, recall_count, called_at, serving_at"

function TopBar({ admin }: { admin: boolean }) {
  return (
    <header className={styles.topbar} data-surface="slate">
      <a href="#main" className={styles.skipLink}>
        Skip to desk
      </a>
      <div className={styles.topbarInner}>
        <BackButton />
        <Logo size={22} />
        <span className={styles.topbarDivider} aria-hidden="true" />
        <span className={styles.topbarLabel}>Doctor desk</span>
        <div className={styles.topbarActions}>
          {admin && (
            <a href="/doctor" className={styles.signOut}>
              Change doctor
            </a>
          )}
          <SignOutButton className={styles.signOut} redirectTo="/login" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

function Empty({ admin, title, body }: { admin: boolean; title: string; body: string }) {
  return (
    <div className={styles.page}>
      <TopBar admin={admin} />
      <main id="main">
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>
            <LogoMark size={26} />
          </span>
          <h1 className={styles.emptyTitle}>{title}</h1>
          <p className={styles.emptyBody}>{body}</p>
        </div>
      </main>
    </div>
  )
}

type Doctor = NonNullable<DeskInfo["doctor"]>

// A doctor (their own 'doctor' role) gets their own desk: the doctor row
// linked to their login, then the counter bound to that doctor. An admin
// picks a doctor first (?doctor=<id>). Staff keep /counter.
export default async function DoctorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
  const profile = profileData as { org_id: string | null; role: string; full_name: string | null } | null
  if (profile?.role === "staff") redirect("/counter")
  if (profile?.role !== "doctor" && profile?.role !== "admin") redirect("/")
  const admin = profile.role === "admin"

  let doctor: Doctor | null = null
  if (!admin) {
    const { data } = await supabase
      .from("doctors")
      .select("id, name, room, specialty")
      .eq("user_id", user.id)
      .maybeSingle()
    doctor = (data as Doctor | null) ?? null
    if (!doctor) {
      return (
        <Empty
          admin={false}
          title="Not linked to a doctor yet"
          body={`Your account (${profile.full_name ?? user.email}) isn’t linked to a doctor profile. Ask an admin to link it.`}
        />
      )
    }
  } else {
    const params = await searchParams
    const pick = typeof params.doctor === "string" ? params.doctor : null
    const { data } = await supabase
      .from("doctors")
      .select("id, name, room, specialty")
      .eq("active", true)
      .order("name")
    const doctors = (data ?? []) as Doctor[]
    doctor = doctors.find((d) => d.id === pick) ?? null
    if (!doctor) {
      return (
        <div className={styles.page}>
          <TopBar admin />
          <main id="main">
            <div className={desk.picker}>
              <h1 className={desk.title}>Choose a doctor’s desk</h1>
              <ul className={desk.pickerList}>
                {doctors.map((d) => (
                  <li key={d.id}>
                    <a href={`/doctor?doctor=${d.id}`} className={desk.pickerItem}>
                      <strong>{d.name}</strong>
                      <span>{[d.specialty, d.room ? `Room ${d.room}` : null].filter(Boolean).join(" · ")}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </main>
        </div>
      )
    }
  }

  const { data: counterData } = await supabase
    .from("counters")
    .select("id, org_id, name, state")
    .eq("doctor_id", doctor.id)
    .order("name")
    .limit(1)
    .maybeSingle()
  const counter = counterData as DeskInfo["counter"] | null
  if (!counter) {
    return (
      <Empty
        admin={admin}
        title="No desk for this doctor yet"
        body={`${doctor.name} has no counter bound to them. An admin can bind one under Counters.`}
      />
    )
  }

  const [currentRes, servicesRes] = await Promise.all([
    supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .eq("counter_id", counter.id)
      .in("status", ACTIVE_TOKEN_STATUSES)
      .limit(1)
      .maybeSingle(),
    supabase.from("counter_services").select("service_id, services(name)").eq("counter_id", counter.id),
  ])

  const links = (servicesRes.data ?? []) as unknown as { service_id: string; services: { name: string } | null }[]
  const info: DeskInfo = {
    counter,
    serviceIds: links.map((l) => l.service_id),
    serviceLabel: links.map((l) => l.services?.name).filter(Boolean).join(" · ") || "No service assigned",
    doctor,
    mode: admin ? "admin" : "self",
  }

  return (
    <div className={styles.page}>
      <TopBar admin={admin} />
      <main id="main">
        <DoctorDesk desk={info} initialToken={(currentRes.data as TokenRow | null) ?? null} />
      </main>
    </div>
  )
}
