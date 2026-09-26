import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Logo, LogoMark } from "@/components/brand/Logo"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { createClient } from "@/lib/supabase/server"
import { SignOutButton } from "@/components/auth/SignOutButton"
import { CounterConsole } from "./counter-console"
import { ACTIVE_TOKEN_STATUSES, TOKEN_COLUMNS, type CounterRow, type ProfileRow, type TokenRow } from "./types"
import styles from "./counter.module.css"

export const metadata: Metadata = {
  title: "Counter",
}

// Slate app bar shared by the console and the no-desk state: skip link, the
// brand mark, the screen name and the theme toggle. data-surface="slate" opts
// it into the on-slate focus ring once globals.css carries that rule.
function CounterTopBar() {
  return (
    <header className={styles.topbar} data-surface="slate">
      <a href="#main" className={styles.skipLink}>
        Skip to console
      </a>
      <div className={styles.topbarInner}>
        <Logo size={22} />
        <span className={styles.topbarDivider} aria-hidden="true" />
        <span className={styles.topbarLabel}>Counter console</span>
        <div className={styles.topbarActions}>
          <a href="/doctor" className={styles.signOut}>
            Doctor desk
          </a>
          <SignOutButton className={styles.signOut} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

export default async function CounterPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login?next=/counter")
  }

  // Real schema (0002_organizations_profiles.sql) has no `staff` table --
  // role lives on profiles.role ('patient' | 'staff' | 'admin'). No RLS
  // SELECT policy on a user's own profiles row has landed yet (same gap
  // lib/supabase/proxy.ts's /admin gate already documents), so a lookup
  // failure fails closed here too rather than granting counter access.
  let profile: ProfileRow | null = null
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id, org_id, role, full_name")
      .eq("id", user.id)
      .maybeSingle()
    profile = (data as ProfileRow | null) ?? null
  } catch {
    profile = null
  }

  if (!profile || (profile.role !== "staff" && profile.role !== "admin")) {
    redirect("/")
  }

  // One desk, one operator: counters.staff_id -> profiles.id. An admin
  // assigns that link elsewhere; this page just reads it.
  const { data: myCounters } = await supabase
    .from("counters")
    .select("id, org_id, name, state")
    .eq("staff_id", user.id)
    .limit(1)

  const counter = ((myCounters?.[0] as CounterRow | undefined) ?? null)

  if (!counter) {
    return (
      <div className={styles.page}>
        <CounterTopBar />
        <main id="main">
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <LogoMark size={26} />
            </span>
            <h1 className={styles.emptyTitle}>No counter assigned</h1>
            <p className={styles.emptyBody}>
              Your account ({profile.full_name ?? user.email}) isn’t linked to a desk yet.
              Ask an admin to assign you a counter.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const [currentTokenRes, servicesRes] = await Promise.all([
    supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .eq("counter_id", counter.id)
      .in("status", ACTIVE_TOKEN_STATUSES)
      .limit(1)
      .maybeSingle(),
    supabase.from("counter_services").select("service_id, services(name, code)").eq("counter_id", counter.id),
  ])

  const services = (servicesRes.data as { service_id: string; services: { name: string; code: string } | null }[] | null) ?? []
  const serviceLabel = services.map((row) => row.services?.name).filter((name): name is string => Boolean(name)).join(" · ") || "No service assigned"
  const serviceIds = services.map((row) => row.service_id)

  // This desk's own org runs on Asia/Kolkata; tokens.service_day is the
  // org's local day (private.service_day), not UTC's -- matching it with
  // the server's UTC date would show yesterday's queue until 05:30 IST.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })

  const waitingRes =
    serviceIds.length > 0
      ? await supabase
          .from("tokens")
          .select(TOKEN_COLUMNS)
          .in("service_id", serviceIds)
          .eq("service_day", today)
          .eq("status", "waiting")
          .order("priority_at", { ascending: true })
      : { data: [] }

  return (
    <div className={styles.page}>
      <CounterTopBar />
      <main id="main">
        <CounterConsole
          counter={counter}
          initialToken={(currentTokenRes.data as TokenRow | null) ?? null}
          initialWaiting={(waitingRes.data as TokenRow[] | null) ?? []}
          serviceIds={serviceIds}
          serviceLabel={serviceLabel}
          staffName={profile.full_name ?? user.email ?? "Staff"}
        />
      </main>
    </div>
  )
}
