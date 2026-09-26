import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { tokenQrSvg } from "@/lib/qr"
import { createClient } from "@/lib/supabase/server"

import { PrintButton } from "./PrintButton"
import styles from "./slip.module.css"

export const metadata: Metadata = {
  title: "OPD case sheet",
}

const LANE_LABEL: Record<string, string> = {
  emergency: "Emergency",
  senior: "Senior citizen",
  pregnant: "Pregnant",
  appointment: "Appointment",
  normal: "Normal",
}

const GENDER_LABEL: Record<string, string> = {
  female: "F",
  male: "M",
  other: "Other",
  prefer_not: "—",
}

function age(dob: string | null): string {
  if (!dob) return "—"
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return "—"
  const now = new Date()
  let years = now.getFullYear() - d.getFullYear()
  const beforeBirthday = now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())
  if (beforeBirthday) years -= 1
  return String(years)
}

function maskPhone(phone: string | null): string {
  if (!phone) return "—"
  const digits = phone.replace(/\D/g, "")
  if (digits.length <= 4) return phone
  return `••••${digits.slice(-4)}`
}

// Access (privacy): the patient who owns this token, or staff/admin of the same org --
// everyone else, including a signed-out visitor, gets a 404 (never a "forbidden" that
// confirms the token exists). Uses the same profiles read every other staff-facing screen
// already relies on (profiles_read_own / profiles_read_org_staff, 0045_profiles_rls.sql).
async function canView(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | null,
  token: { patient_id: string | null; org_id: string },
): Promise<boolean> {
  if (!userId) return false
  if (token.patient_id === userId) return true
  const { data: viewer } = await supabase.from("profiles").select("role, org_id").eq("id", userId).maybeSingle()
  return Boolean(viewer && viewer.org_id === token.org_id && (viewer.role === "staff" || viewer.role === "admin"))
}

export default async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: token } = await supabase
    .from("tokens")
    .select(
      "id, code, number, lane, priority_at, status, patient_id, walk_in_label, walkin_patient_id, doctor_id, org_id, service_id, counter_id, fee_inr, created_at, services(name), counters(name), doctors(name, room), organizations(name)",
    )
    .eq("id", id)
    .maybeSingle()

  if (!token) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const allowed = await canView(supabase, user?.id ?? null, token)
  if (!allowed) notFound()

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
  const service = one(token.services as { name: string } | { name: string }[] | null)
  const counter = one(token.counters as { name: string } | { name: string }[] | null)
  const doctor = one(token.doctors as { name: string; room: string | null } | { name: string; room: string | null }[] | null)
  const org = one(token.organizations as { name: string } | { name: string }[] | null)

  // Patient block: a real patient's own profile, or -- for a cash walk-in -- the
  // walkin_patients row if it's readable at all (it's documented as effectively
  // private, RPC-only), falling back to just the walk-in label the kiosk collected.
  let patientName = "—"
  let patientPhone: string | null = null
  let patientDob: string | null = null
  let patientGender: string | null = null
  let patientCity: string | null = null

  if (token.patient_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone, date_of_birth, gender, city")
      .eq("id", token.patient_id)
      .maybeSingle()
    patientName = profile?.full_name ?? "—"
    patientPhone = (profile?.phone as string | null) ?? null
    patientDob = (profile?.date_of_birth as string | null) ?? null
    patientGender = (profile?.gender as string | null) ?? null
    patientCity = (profile?.city as string | null) ?? null
  } else if (token.walkin_patient_id) {
    const { data: walkin } = await supabase
      .from("walkin_patients")
      .select("full_name, phone, date_of_birth, gender, city")
      .eq("id", token.walkin_patient_id)
      .maybeSingle()
    patientName = walkin?.full_name ?? token.walk_in_label ?? "—"
    patientPhone = (walkin?.phone as string | null) ?? null
    patientDob = (walkin?.date_of_birth as string | null) ?? null
    patientGender = (walkin?.gender as string | null) ?? null
    patientCity = (walkin?.city as string | null) ?? null
  } else {
    patientName = token.walk_in_label ?? "—"
  }

  // Fee paid: Cash (staff-collected, cash_receipts) beats Paid (online, my_payment_status)
  // beats Unpaid (a fee is on record but neither shows) -- omitted entirely when there's
  // no fee at all. Both reads are best-effort: cash_receipts has no patient-facing RLS
  // (only staff/admin can read it directly) and my_payment_status is patient-owned only,
  // so whichever the current viewer can't read simply comes back empty, not an error.
  let feeStatus: "Paid" | "Cash" | "Unpaid" | null = null
  if (token.fee_inr) {
    const { data: cash } = await supabase
      .from("cash_receipts")
      .select("amount_inr")
      .eq("token_id", token.id)
      .gt("amount_inr", 0)
      .limit(1)
      .maybeSingle()
    if (cash) {
      feeStatus = "Cash"
    } else {
      const { data: payment } = await supabase.rpc("my_payment_status", { p_token_id: token.id }).maybeSingle()
      feeStatus = payment && (payment as { status?: string }).status === "captured" ? "Paid" : "Unpaid"
    }
  }

  const statusUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://lpu.lol"}/t/${token.id}`
  const qr = await tokenQrSvg(statusUrl)
  const visitDate = new Date(token.created_at as string)

  return (
    <main id="main" className={styles.page}>
      <div className={`${styles.toolbar} ${styles.noPrint}`}>
        <PrintButton />
      </div>

      <div className={styles.sheet}>
        <header className={styles.header}>
          <p className={styles.hospital}>{org?.name ?? "Queueless"}</p>
          <p className={styles.title}>OPD Case Sheet</p>
          <p className={styles.dateTime}>
            {visitDate.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })} ·{" "}
            {visitDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </header>

        <section className={styles.block}>
          <div className={styles.row}>
            <span className={styles.field}>
              <span className={styles.label}>Patient</span>
              <span className={styles.value} translate="no">{patientName}</span>
            </span>
            <span className={styles.field}>
              <span className={styles.label}>Age / Sex</span>
              <span className={styles.value}>
                {age(patientDob)} / {patientGender ? (GENDER_LABEL[patientGender] ?? "—") : "—"}
              </span>
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.field}>
              <span className={styles.label}>Phone</span>
              <span className={styles.value}>{maskPhone(patientPhone)}</span>
            </span>
            <span className={styles.field}>
              <span className={styles.label}>City</span>
              <span className={styles.value}>{patientCity ?? "—"}</span>
            </span>
          </div>
        </section>

        <section className={`${styles.block} ${styles.visitBlock}`}>
          <div className={styles.tokenCol}>
            <p className={styles.tokenCode} translate="no">{token.code}</p>
            <p className={styles.tokenSub}>{service?.name ?? "—"}</p>
          </div>
          <div className={styles.visitDetails}>
            <div className={styles.row}>
              <span className={styles.field}>
                <span className={styles.label}>Doctor</span>
                <span className={styles.value} translate="no">{doctor?.name ?? "—"}</span>
              </span>
              <span className={styles.field}>
                <span className={styles.label}>Room</span>
                <span className={styles.value}>{doctor?.room ?? counter?.name ?? "—"}</span>
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.field}>
                <span className={styles.label}>Lane</span>
                <span className={styles.value}>{LANE_LABEL[token.lane as string] ?? token.lane}</span>
              </span>
              <span className={styles.field}>
                <span className={styles.label}>Fee</span>
                <span className={styles.value}>{feeStatus ?? "No fee"}</span>
              </span>
            </div>
          </div>
          <div className={styles.qr} role="img" aria-label="QR code to this token's status page" dangerouslySetInnerHTML={{ __html: qr }} />
        </section>

        <section className={styles.vitals}>
          {["BP", "Pulse", "Temp", "Weight", "SpO₂"].map((label) => (
            <span key={label} className={styles.vital}>
              <span className={styles.vitalLabel}>{label}</span>
              <span className={styles.vitalBox} />
            </span>
          ))}
        </section>

        {["Complaints", "Examination / Findings", "Diagnosis", "Rx (Prescription)", "Advice", "Follow-up date"].map(
          (heading) => (
            <section key={heading} className={styles.ruled}>
              <p className={styles.ruledLabel}>{heading}</p>
              <div className={styles.ruledLines} />
            </section>
          ),
        )}

        <footer className={styles.footer}>
          <span className={styles.signature}>Doctor&apos;s signature</span>
          <span className={styles.generated}>Generated by Queueless</span>
        </footer>
      </div>
    </main>
  )
}
