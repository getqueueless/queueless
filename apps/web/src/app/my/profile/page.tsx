import type { Metadata } from "next"

import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { createClient } from "@/lib/supabase/server"

import { ProfileForm } from "./ProfileForm"
import styles from "./profile.module.css"

export const metadata: Metadata = {
  title: "Complete your profile",
}

function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x1f]/.test(path)) return "/my"
  return path
}

// P2 fix: "Edit profile" opened this page blank for a patient who'd already completed it,
// forcing a full re-entry. Prefills from the saved row. profiles has real RLS now
// (0045_profiles_rls.sql) -- `id = auth.uid()` covers this read -- but its column grant to
// `authenticated` only lists full_name/phone/language; date_of_birth/gender/city/
// address_line aren't in that grant. If that turns out to also block reading them (not
// just writing), those fields just come back null here and the form falls back to its
// existing empty-field behavior -- not a regression, same as a first-time patient today.
async function fetchMyProfileFields(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, phone, date_of_birth, gender, city, address_line")
    .eq("id", userId)
    .maybeSingle()
  return data
}

export default async function CompleteProfilePage({ searchParams }: PageProps<"/my/profile">) {
  const params = await searchParams
  const next = safeNextPath(params.next)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const row = user ? await fetchMyProfileFields(supabase, user.id) : null

  const initialValues = row
    ? {
        fullName: row.full_name ?? "",
        phone: (row.phone as string | null)?.replace(/^\+91/, "") ?? "",
        dateOfBirth: row.date_of_birth ?? "",
        gender: row.gender ?? "",
        city: row.city ?? "",
        addressLine: row.address_line ?? "",
      }
    : null

  return (
    <main id="main" className={styles.page}>
      <div className={styles.card}>
        <TwoToneHeading as="h1" lead="One quick" accent="step" />
        <p className={styles.subtitle}>
          A few details before you can take a token or book an appointment — this is what lets
          staff call you by name and reach you if your turn is coming up.
        </p>
        <ProfileForm next={next} initialValues={initialValues} />
      </div>
    </main>
  )
}
