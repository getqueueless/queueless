import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import type { ReactNode } from "react"

import { Logo, LogoMark } from "@/components/brand/Logo"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { createClient } from "@/lib/supabase/server"

import { CashWalkinForm, type DoctorOption } from "./cash-walkin-form"
import { IssuedTokenView } from "./issued-token-view"
import { KioskForm, type ServiceOption } from "./kiosk-form"
import styles from "./kiosk.module.css"
import { TokenSlip } from "./token-slip"

export const metadata: Metadata = {
  title: "Kiosk",
}

// Reduced chrome on purpose, instead of PublicHeader/PublicFooter: this
// terminal stays signed in to a staff account, so it offers no links out
// (the signed-out gate alone links to /#status, with no session to leak).
// The public nav + footer would walk a patient from Home to "Admin
// dashboard" on a signed-in device. Logo, a terminal tag, the theme toggle.
function KioskShell({
  lead,
  accent,
  intro,
  narrow = false,
  children,
}: {
  lead: string
  accent: string
  intro?: string
  narrow?: boolean
  children: ReactNode
}) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Logo size={26} />
          <span className={styles.terminalTag}>Reception kiosk</span>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className={narrow ? `${styles.page} ${styles.narrow}` : styles.page}>
        <div className={styles.band}>
          <LogoMark size={340} className={styles.bandMark} />
          <div className={styles.bandInner}>
            <TwoToneHeading as="h1" lead={lead} accent={accent} onDark />
            {intro ? <p className={styles.intro}>{intro}</p> : null}
          </div>
        </div>
        <div className={styles.stage}>{children}</div>
      </main>
    </>
  )
}

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  const h = await headers()
  const proto = h.get("x-forwarded-proto") ?? "http"
  const host = h.get("host") ?? "localhost:3000"
  return `${proto}://${host}`
}

export default async function KioskPage({ searchParams }: PageProps<"/kiosk">) {
  const params = await searchParams
  const issuedId = typeof params.issued === "string" ? params.issued : null
  const issuedNumber = typeof params.number === "string" ? Number(params.number) : null
  const issuedCode = typeof params.code === "string" ? params.code : null
  const issuedServiceId = typeof params.service_id === "string" ? params.service_id : null
  const issuedByCash = params.cash === "1"
  const mode = params.mode === "cash" ? "cash" : "token"

  const supabase = await createClient()

  // DEPENDENCY: `staff_issue_token` (see actions.ts) requires a staff-role
  // JWT, but proxy.ts lists `/kiosk` as a public path so a receptionist's
  // dropped session never bounces this terminal to /login mid-demo. That
  // means THIS page has to do its own check instead of relying on the
  // proxy: no session -> show a sign-in prompt rather than a form that would
  // just fail with "forbidden" on submit.
  const { data: claims } = await supabase.auth.getClaims()
  const signedIn = Boolean(claims?.claims.sub)

  // Non-breaking hyphens (U+2011) in headings: text-wrap: balance would
  // otherwise split "SIGN-" / "IN" on a phone.
  if (!signedIn) {
    return (
      <KioskShell lead="Staff sign‑in" accent="needed" narrow>
        <div className={styles.card}>
          <p className={styles.subtitle}>
            This terminal issues walk-in tokens once a staff member signs in.
            Ask a supervisor to sign in on this device.
          </p>
          <Link href="/login?next=/kiosk" className={styles.signInCta}>
            Sign in
          </Link>
          {/* The landing's "Get a token" lands patients here too. */}
          <div className={styles.patientNote}>
            <p>
              <strong>Here for a token?</strong> Ask at the reception desk.
            </p>
            <Link href="/#status" className={styles.textLink}>
              Check your status
            </Link>
          </div>
        </div>
      </KioskShell>
    )
  }

  // `services` is only selectable when signed in (supabase/README.md's read
  // grant table) -- reachable here since we just confirmed a session above.
  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, name, code")
    .eq("is_open", true)
    .order("name")

  // Cash walk-in mode only: doctor picker with fee shown. Not scoped to open
  // services -- staff_register_walkin itself gates on the doctor's own service
  // being open (service_closed), same failure path as the token form already
  // surfaces via errorInfo.
  const { data: doctors, error: doctorsError } =
    mode === "cash"
      ? await supabase
          .from("doctors")
          .select("id, name, specialty, service_id, fee_inr")
          .eq("active", true)
          .order("name")
      : { data: null, error: null }

  if (issuedId) {
    // Re-read the freshly-minted row instead of trusting the query string
    // as-is: `?issued=/&number=/&code=` came from our own redirect after a
    // real RPC call, but a URL is still user-editable, and this is the
    // receipt a patient walks off with -- it should reflect the database,
    // not whatever a tampered link claims. Falls back to the redirect's own
    // params only if this select comes back empty, which happens if the
    // `tokens` RLS read grant for staff isn't landed yet (also stubbed --
    // see supabase/README.md's read-grant table).
    const { data: tokenRow } = await supabase
      .from("tokens")
      .select("id, number, code, service_id, services(name)")
      .eq("id", issuedId)
      .maybeSingle()

    const number = tokenRow?.number ?? issuedNumber
    const code = tokenRow?.code ?? issuedCode
    const serviceId = tokenRow?.service_id ?? issuedServiceId
    const serviceNameFromRow = (
      tokenRow?.services as { name?: string } | { name?: string }[] | null | undefined
    )
    const joinedName = Array.isArray(serviceNameFromRow)
      ? serviceNameFromRow[0]?.name
      : serviceNameFromRow?.name
    const serviceName =
      joinedName ?? services?.find((s) => s.id === serviceId)?.name ?? "WaitWise"

    if (number !== null && number !== undefined && !Number.isNaN(number) && code) {
      const origin = await siteOrigin()
      const statusUrl = `${origin}/t/${issuedId}`

      return (
        <KioskShell lead="Token" accent="issued">
          <IssuedTokenView code={code} serviceName={serviceName} tokenId={issuedId}>
            <TokenSlip
              statusUrl={statusUrl}
              serviceName={serviceName}
              number={number}
              code={code}
              note={issuedByCash ? "Claim online with this phone number" : undefined}
            />
          </IssuedTokenView>
        </KioskShell>
      )
    }
  }

  const doctorOptions: DoctorOption[] = (doctors ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    specialty: d.specialty,
    serviceId: d.service_id,
    feeInr: d.fee_inr,
  }))

  return (
    <KioskShell
      lead="Walk‑in"
      accent="kiosk"
      intro={mode === "cash" ? "Take cash and issue a ticket for a doctor's fee." : "Pick a service to issue a token."}
    >
      <div className={styles.card}>
        <div className={styles.modeToggle} role="tablist" aria-label="Walk-in mode">
          <Link
            href="/kiosk"
            role="tab"
            aria-selected={mode === "token"}
            className={mode === "token" ? `${styles.modeLink} ${styles.modeLinkActive}` : styles.modeLink}
          >
            Kiosk token
          </Link>
          <Link
            href="/kiosk?mode=cash"
            role="tab"
            aria-selected={mode === "cash"}
            className={mode === "cash" ? `${styles.modeLink} ${styles.modeLinkActive}` : styles.modeLink}
          >
            Cash walk-in
          </Link>
        </div>

        {mode === "cash" ? (
          doctorsError || doctorOptions.length === 0 ? (
            <p className={styles.emptyState}>
              {doctorsError ? "Couldn’t load doctors right now. Ask staff, or " : "No doctors are set up yet. "}
              <Link href="/kiosk?mode=cash">refresh</Link> to try again.
            </p>
          ) : (
            <CashWalkinForm doctors={doctorOptions} />
          )
        ) : servicesError || !services || services.length === 0 ? (
          <p className={styles.emptyState}>
            {servicesError
              ? "Couldn’t load services right now. Ask staff, or "
              : "No services are open right now. "}
            <Link href="/kiosk">refresh</Link> to try again.
          </p>
        ) : (
          <KioskForm services={services as ServiceOption[]} />
        )}
      </div>
    </KioskShell>
  )
}
