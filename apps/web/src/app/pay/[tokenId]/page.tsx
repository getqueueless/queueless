import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { createClient } from "@/lib/supabase/server"
import { fetchDoctor, fetchPayableToken, isUuid } from "./data"
import { PayView } from "./pay-view"
import styles from "./pay.module.css"

export const metadata: Metadata = {
  title: "Pay & book",
}

function NotFoundCard() {
  return (
    <>
      <PublicHeader />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <LogoMark size={300} className={styles.bandMark} />
          <TwoToneHeading as="h1" lead="Booking not" accent="found" onDark align="center" />
        </div>
        <div className={styles.card}>
          <p className={styles.subtitle}>
            This payment link may have expired, or the spot was already released. Go back and
            book again.
          </p>
          <Link href="/" className={styles.cta}>
            Back home
          </Link>
        </div>
      </main>
      <PublicFooter />
    </>
  )
}

export default async function PayPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params
  if (!isUuid(tokenId)) {
    return <NotFoundCard />
  }

  const supabase = await createClient()
  const token = await fetchPayableToken(supabase, tokenId)
  if (!token) {
    return <NotFoundCard />
  }

  const doctor = token.doctor_id ? await fetchDoctor(supabase, token.doctor_id) : null

  return (
    <>
      <PublicHeader />
      <PayView tokenId={tokenId} initialToken={token} doctor={doctor} />
      <PublicFooter />
    </>
  )
}
