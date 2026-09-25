import type { Metadata } from "next"

import { TwoToneHeading } from "@/components/site/TwoToneHeading"

import { ProfileForm } from "./ProfileForm"
import styles from "./profile.module.css"

export const metadata: Metadata = {
  title: "Complete your profile",
}

function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/my"
  return path
}

export default async function CompleteProfilePage({ searchParams }: PageProps<"/my/profile">) {
  const params = await searchParams
  const next = safeNextPath(params.next)

  return (
    <main id="main" className={styles.page}>
      <div className={styles.card}>
        <TwoToneHeading as="h1" lead="One quick" accent="step" />
        <p className={styles.subtitle}>
          A few details before you can take a token or book an appointment — this is what lets
          staff call you by name and reach you if your turn is coming up.
        </p>
        <ProfileForm next={next} />
      </div>
    </main>
  )
}
