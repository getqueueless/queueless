import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Logo, LogoMark } from "@/components/brand/Logo"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { createClient } from "@/lib/supabase/server"
import { SignOutButton } from "@/components/auth/SignOutButton"
import { CounterConsole } from "./counter-console"
import { ACTIVE_TOKEN_STATUSES, type CounterRow, type ProfileRow, type TokenRow } from "./types"
import styles from "./counter.module.css"

export const metadata: Metadata = {
  title: "Counter",
}

const TOKEN_COLUMNS =
  "id, org_id, service_id, service_day, number, code, lane, status, patient_id, walk_in_label, counter_id, recall_count, called_at, serving_at"

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
    // /counter is staff-only -- /login is now the patient-only sign-in page
    // (Google/email code, no password tab), so a bounced staff member needs
    // /staff instead (same target proxy.ts's own middleware gate already
    // uses for this path).
    redirect("/staff?next=/counter")
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
    supabase.from("counter_services").select("services(name, code)").eq("counter_id", counter.id),
  ])

  const serviceLabel =
    (servicesRes.data as { services: { name: string; code: string } | null }[] | null)
      ?.map((row) => row.services?.name)
      .filter((name): name is string => Boolean(name))
      .join(" · ") || "No service assigned"

  return (
    <div className={styles.page}>
      <CounterTopBar />
      <main id="main">
        <CounterConsole
          counter={counter}
          initialToken={(currentTokenRes.data as TokenRow | null) ?? null}
          serviceLabel={serviceLabel}
          staffName={profile.full_name ?? user.email ?? "Staff"}
        />
      </main>
    </div>
  )
}
