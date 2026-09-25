import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"

import { IssuedTokenView } from "./issued-token-view"
import { KioskForm, type ServiceOption } from "./kiosk-form"
import styles from "./kiosk.module.css"
import { TokenSlip } from "./token-slip"

export const metadata: Metadata = {
  title: "Kiosk — Queueless",
}

async function siteOrigin(): Promise<string> {
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

  const supabase = await createClient()

  // DEPENDENCY: `staff_issue_token` (see actions.ts) requires a staff-role
  // JWT, but proxy.ts lists `/kiosk` as a public path so a receptionist's
  // dropped session never bounces this terminal to /login mid-demo. That
  // means THIS page has to do its own check instead of relying on the
  // proxy: no session -> show a sign-in prompt rather than a form that would
  // just fail with "forbidden" on submit.
  const { data: claims } = await supabase.auth.getClaims()
  const signedIn = Boolean(claims?.claims.sub)

  if (!signedIn) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Kiosk sign-in required</h1>
          <p className={styles.subtitle}>
            This terminal needs a staff account signed in before it can issue
            walk-in tokens. Ask a supervisor to sign in on this device.
          </p>
          <Link href="/login?next=/kiosk" className={styles.signInCta}>
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  // `services` is only selectable when signed in (supabase/README.md's read
  // grant table) -- reachable here since we just confirmed a session above.
  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, name, code")
    .eq("is_open", true)
    .order("name")

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
      joinedName ?? services?.find((s) => s.id === serviceId)?.name ?? "Queueless"

    if (number !== null && number !== undefined && !Number.isNaN(number) && code) {
      const origin = await siteOrigin()
      const statusUrl = `${origin}/t/${issuedId}`

      return (
        <main className={styles.page}>
          <IssuedTokenView number={number} serviceName={serviceName}>
            <TokenSlip statusUrl={statusUrl} serviceName={serviceName} number={number} code={code} />
          </IssuedTokenView>
        </main>
      )
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Walk-in kiosk</h1>
        <p className={styles.subtitle}>Pick a service to issue a token.</p>

        {servicesError || !services || services.length === 0 ? (
          <p className={styles.emptyState}>
            {servicesError
              ? "Couldn't load services right now. Ask staff, or "
              : "No services are open right now. "}
            <Link href="/kiosk">refresh</Link> to try again.
          </p>
        ) : (
          <KioskForm services={services as ServiceOption[]} />
        )}
      </div>
    </main>
  )
}
