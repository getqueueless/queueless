import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { getMyProfile } from "@/lib/supabase/get-role"

import { ClaimTicketForm } from "./ClaimTicketForm"
import { DoctorActions } from "./DoctorActions"
import styles from "./my.module.css"

type MyToken = {
  id: string
  code: string
  status: string
  services: { name: string } | { name: string }[] | null
}

const ACTIVE_STATUSES = ["pending_payment", "waiting", "called", "serving"]

function serviceName(row: MyToken): string {
  const s = row.services
  if (!s) return "Queueless"
  return Array.isArray(s) ? (s[0]?.name ?? "Queueless") : s.name
}

export default async function MyHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [profile, tokensRes, doctorsRes] = await Promise.all([
    user ? getMyProfile(supabase, user.id) : Promise.resolve(null),
    user
      ? supabase
          .from("tokens")
          .select("id, code, status, services(name)")
          .eq("patient_id", user.id)
          .in("status", ACTIVE_STATUSES)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    supabase
      .from("doctors")
      .select("id, service_id, name, specialty, qualification, room, photo_url, fee_inr")
      .eq("active", true)
      .order("name"),
  ])
  const tokens = (tokensRes.data as MyToken[] | null) ?? []

  return (
    <div className={styles.placeholder}>
      <h1>Welcome{profile?.fullName ? `, ${profile.fullName}` : ""}.</h1>
      <p>Take a token, book an appointment, and check your queue status here.</p>

      <section className={styles.section} aria-labelledby="my-tokens-heading">
        <h2 id="my-tokens-heading" className={styles.sectionTitle}>My active tokens</h2>
        {tokens.length === 0 ? (
          <p className={styles.empty}>No active tokens right now.</p>
        ) : (
          <ul className={styles.tokenList}>
            {tokens.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.id}`} className={styles.tokenLink}>
                  <span className={styles.tokenCode} translate="no">{t.code}</span>
                  <span>{serviceName(t)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="claim-heading">
        <h2 id="claim-heading" className={styles.sectionTitle}>Claim a paper ticket</h2>
        <ClaimTicketForm />
      </section>

      <DoctorActions doctors={doctorsRes.data ?? []} />

      <section className={styles.section}>
        <Link href="/my/profile" className={styles.editProfileLink}>Edit profile</Link>
      </section>
    </div>
  )
}
