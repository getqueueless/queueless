"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { describeSupabaseError } from "../_lib/describe-error"
import type {
  DoctorBreakRow,
  DoctorLeaveRow,
  DoctorRow,
  DoctorScheduleRow,
  DoctorStatus,
  DoctorStatusTodayRow,
  ServiceRow,
} from "../_lib/types"
import { DoctorLoginPanel } from "./DoctorLoginPanel"
import styles from "../admin.module.css"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const STATUSES: DoctorStatus[] = ["available", "running_late", "on_break", "off"]

type DoctorForm = {
  service_id: string
  name: string
  specialty: string
  qualification: string
  room: string
  photo_url: string
  fee_inr: string
  active: boolean
}

const EMPTY_DOCTOR: DoctorForm = { service_id: "", name: "", specialty: "", qualification: "", room: "", photo_url: "", fee_inr: "0", active: true }

function statusBadgeClass(status: DoctorStatus): string {
  if (status === "available") return `${styles.badge} ${styles.badgeSuccess}`
  if (status === "off") return `${styles.badge} ${styles.badgeMuted}`
  return `${styles.badge} ${styles.badgeWarning}`
}

export function DoctorsManager({
  initialDoctors,
  initialStatuses,
  services,
  orgId,
}: {
  initialDoctors: DoctorRow[]
  initialStatuses: DoctorStatusTodayRow[]
  services: ServiceRow[]
  orgId: string | null
}) {
  const [doctors, setDoctors] = useState(initialDoctors)
  const [statuses, setStatuses] = useState(initialStatuses)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<DoctorForm>(EMPTY_DOCTOR)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduleDoctorId, setScheduleDoctorId] = useState<string | null>(null)
  const [loginDoctorId, setLoginDoctorId] = useState<string | null>(null)

  const supabase = createClient()

  async function refreshDoctors() {
    const [d, s] = await Promise.all([
      supabase.from("doctors").select("id, org_id, service_id, name, specialty, qualification, room, photo_url, fee_inr, active, created_at").order("name"),
      supabase.from("doctor_status_today").select("doctor_id, org_id, status, late_minutes"),
    ])
    if (d.data) setDoctors(d.data as DoctorRow[])
    if (s.data) setStatuses(s.data as DoctorStatusTodayRow[])
  }

  function startEdit(d: DoctorRow) {
    setEditingId(d.id)
    setForm({
      service_id: d.service_id,
      name: d.name,
      specialty: d.specialty,
      qualification: d.qualification ?? "",
      room: d.room ?? "",
      photo_url: d.photo_url ?? "",
      fee_inr: String(d.fee_inr),
      active: d.active,
    })
    setError(null)
  }

  function startCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_DOCTOR, service_id: services[0]?.id ?? "" })
    setError(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim() || !form.specialty.trim() || !form.service_id) {
      setError("Service, name and specialty are required.")
      return
    }

    setBusy(true)
    const { error } = await supabase.rpc("admin_upsert_doctor", {
      p_id: editingId,
      p_service_id: form.service_id,
      p_name: form.name.trim(),
      p_specialty: form.specialty.trim(),
      p_qualification: form.qualification.trim() || null,
      p_room: form.room.trim() || null,
      p_photo_url: form.photo_url.trim() || null,
      p_fee_inr: Number(form.fee_inr) || 0,
      p_active: form.active,
    })
    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    await refreshDoctors()
    startCreate()
  }

  async function deactivate(d: DoctorRow) {
    if (!confirm(`Deactivate ${d.name}? Their history is kept; they stop appearing for new bookings.`)) return
    setBusy(true)
    const { error } = await supabase.rpc("admin_upsert_doctor", {
      p_id: d.id,
      p_service_id: d.service_id,
      p_name: d.name,
      p_specialty: d.specialty,
      p_qualification: d.qualification,
      p_room: d.room,
      p_photo_url: d.photo_url,
      p_fee_inr: d.fee_inr,
      p_active: false,
    })
    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    await refreshDoctors()
  }

  async function updateStatus(doctorId: string, status: DoctorStatus) {
    let lateMinutes: number | null = null
    if (status === "running_late") {
      const entered = window.prompt("Running how many minutes late?", "15")
      if (entered === null) return
      lateMinutes = Number(entered)
      if (!Number.isFinite(lateMinutes) || lateMinutes <= 0) {
        setError("Enter a positive number of minutes.")
        return
      }
    }
    setBusy(true)
    const { error } = await supabase.rpc("set_doctor_status", { p_doctor: doctorId, p_status: status, p_late_minutes: lateMinutes })
    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    await refreshDoctors()
  }

  function editAndFocus(d: DoctorRow) {
    startEdit(d)
    document.getElementById("doc-name")?.focus()
  }

  const statusFor = (id: string) => statuses.find((s) => s.doctor_id === id)

  return (
    <div className={styles.stack}>
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {error}
        </div>
      )}

      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Service</th>
              <th scope="col">Today</th>
              <th scope="col" className={styles.num}>
                Fee
              </th>
              <th scope="col">Active</th>
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {doctors.map((d) => {
              const status = statusFor(d.id)
              const service = services.find((s) => s.id === d.service_id)
              return (
                <tr key={d.id} className={editingId === d.id ? styles.rowEditing : undefined}>
                  <td>
                    {d.name}
                    <div className={styles.hint}>{d.specialty}</div>
                  </td>
                  <td>{service?.name ?? <span className={styles.cellMuted}>Unknown</span>}</td>
                  <td>
                    <select
                      className={styles.select}
                      aria-label={`Set today's status for ${d.name}`}
                      value={status?.status ?? "available"}
                      disabled={busy}
                      onChange={(e) => updateStatus(d.id, e.target.value as DoctorStatus)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    {status?.status === "running_late" && status.late_minutes && (
                      <span className={statusBadgeClass(status.status)}>{status.late_minutes}m late</span>
                    )}
                  </td>
                  <td className={styles.num}>₹{d.fee_inr}</td>
                  <td>
                    <span className={d.active ? `${styles.badge} ${styles.badgeSuccess}` : `${styles.badge} ${styles.badgeMuted}`}>
                      {d.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className={styles.buttonRow}>
                      <button type="button" className={styles.buttonSecondary} onClick={() => editAndFocus(d)}>
                        Edit<span className={styles.srOnly}> {d.name}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        onClick={() => setScheduleDoctorId(scheduleDoctorId === d.id ? null : d.id)}
                      >
                        {scheduleDoctorId === d.id ? "Hide schedule" : "Schedule"}
                      </button>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        onClick={() => setLoginDoctorId(loginDoctorId === d.id ? null : d.id)}
                      >
                        {loginDoctorId === d.id ? "Hide login" : "Login"}
                      </button>
                      {d.active && (
                        <button type="button" className={styles.buttonDanger} onClick={() => deactivate(d)} disabled={busy}>
                          Deactivate<span className={styles.srOnly}> {d.name}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {doctors.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.emptyCell}>
                  No doctors yet. Add the first one with the form below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {scheduleDoctorId && (
        <DoctorScheduleEditor doctorId={scheduleDoctorId} doctorName={doctors.find((d) => d.id === scheduleDoctorId)?.name ?? ""} />
      )}

      {loginDoctorId && (
        <DoctorLoginPanel doctorId={loginDoctorId} doctorName={doctors.find((d) => d.id === loginDoctorId)?.name ?? ""} />
      )}

      <section className={styles.card} aria-labelledby="doc-form-title">
        <h2 id="doc-form-title" className={styles.cardTitle}>
          {editingId ? "Edit doctor" : "New doctor"}
        </h2>
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="doc-service">Service</label>
            <select id="doc-service" className={styles.select} value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} required>
              <option value="" disabled>
                Choose a service
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="doc-name">Name</label>
            <input id="doc-name" className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="doc-specialty">Specialty</label>
            <input id="doc-specialty" className={styles.input} value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="doc-qualification">Qualification</label>
            <input id="doc-qualification" className={styles.input} value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="doc-room">Room</label>
            <input id="doc-room" className={styles.input} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="doc-fee">Consultation fee (₹)</label>
            <input id="doc-fee" type="number" inputMode="numeric" min={0} className={styles.input} value={form.fee_inr} onChange={(e) => setForm({ ...form, fee_inr: e.target.value })} />
          </div>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.buttonPrimary} disabled={busy || !orgId}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add doctor"}
            </button>
            {editingId && (
              <button type="button" className={styles.buttonSecondary} onClick={startCreate}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}

// ---------- Shifts, breaks, leaves ----------

function DoctorScheduleEditor({ doctorId, doctorName }: { doctorId: string; doctorName: string }) {
  const supabase = createClient()
  const [schedules, setSchedules] = useState<DoctorScheduleRow[]>([])
  const [breaks, setBreaks] = useState<DoctorBreakRow[]>([])
  const [leaves, setLeaves] = useState<DoctorLeaveRow[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [s, b, l] = await Promise.all([
      supabase.from("doctor_schedules").select("id, doctor_id, weekday, start_time, end_time, max_patients, slot_minutes").eq("doctor_id", doctorId).order("weekday"),
      supabase.from("doctor_breaks").select("id, doctor_id, weekday, start_time, end_time").eq("doctor_id", doctorId).order("weekday"),
      supabase.from("doctor_leaves").select("id, doctor_id, from_date, to_date, reason").eq("doctor_id", doctorId).order("from_date"),
    ])
    if (s.data) setSchedules(s.data as DoctorScheduleRow[])
    if (b.data) setBreaks(b.data as DoctorBreakRow[])
    if (l.data) setLeaves(l.data as DoctorLeaveRow[])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when the selected doctor changes, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId])

  return (
    <section className={styles.card} aria-labelledby={`sched-title-${doctorId}`}>
      <h2 id={`sched-title-${doctorId}`} className={styles.cardTitle}>
        Schedule — {doctorName}
      </h2>
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {error}
        </div>
      )}
      <div className={styles.stack}>
        <ScheduleList doctorId={doctorId} rows={schedules} onChange={load} onError={setError} />
        <BreakList doctorId={doctorId} rows={breaks} onChange={load} onError={setError} />
        <LeaveList doctorId={doctorId} rows={leaves} onChange={load} onError={setError} />
      </div>
    </section>
  )
}

function ScheduleList({ doctorId, rows, onChange, onError }: { doctorId: string; rows: DoctorScheduleRow[]; onChange: () => void; onError: (m: string) => void }) {
  const supabase = createClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [weekday, setWeekday] = useState("1")
  const [startTime, setStartTime] = useState("09:00")
  const [endTime, setEndTime] = useState("13:00")
  const [maxPatients, setMaxPatients] = useState("20")
  const [slotMinutes, setSlotMinutes] = useState("15")
  const [busy, setBusy] = useState(false)

  function reset() {
    setEditingId(null)
    setWeekday("1")
    setStartTime("09:00")
    setEndTime("13:00")
    setMaxPatients("20")
    setSlotMinutes("15")
  }

  function edit(r: DoctorScheduleRow) {
    setEditingId(r.id)
    setWeekday(String(r.weekday))
    setStartTime(r.start_time.slice(0, 5))
    setEndTime(r.end_time.slice(0, 5))
    setMaxPatients(String(r.max_patients))
    setSlotMinutes(String(r.slot_minutes))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.rpc("admin_upsert_doctor_schedule", {
      p_id: editingId,
      p_doctor_id: doctorId,
      p_weekday: Number(weekday),
      p_start_time: startTime,
      p_end_time: endTime,
      p_max_patients: Number(maxPatients),
      p_slot_minutes: Number(slotMinutes),
    })
    setBusy(false)
    if (error) return onError(describeSupabaseError(error))
    reset()
    onChange()
  }

  async function remove(id: string) {
    if (!confirm("Remove this shift?")) return
    const { error } = await supabase.rpc("admin_delete_doctor_schedule", { p_id: id })
    if (error) return onError(describeSupabaseError(error))
    onChange()
  }

  return (
    <div className={styles.fieldset}>
      <h3 className={styles.label}>Weekly shifts</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Hours</th>
            <th scope="col" className={styles.num}>
              Max patients
            </th>
            <th scope="col" className={styles.num}>
              Slot
            </th>
            <th scope="col">
              <span className={styles.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{WEEKDAYS[r.weekday]}</td>
              <td>
                {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
              </td>
              <td className={styles.num}>{r.max_patients}</td>
              <td className={styles.num}>{r.slot_minutes}m</td>
              <td>
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} onClick={() => edit(r)}>
                    Edit
                  </button>
                  <button type="button" className={styles.buttonDanger} onClick={() => remove(r.id)}>
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.emptyCell}>
                No shifts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label htmlFor={`sh-day-${doctorId}`}>Day</label>
          <select id={`sh-day-${doctorId}`} className={styles.select} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`sh-start-${doctorId}`}>Start</label>
          <input id={`sh-start-${doctorId}`} type="time" className={styles.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`sh-end-${doctorId}`}>End</label>
          <input id={`sh-end-${doctorId}`} type="time" className={styles.input} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`sh-max-${doctorId}`}>Max patients</label>
          <input id={`sh-max-${doctorId}`} type="number" min={1} className={styles.input} value={maxPatients} onChange={(e) => setMaxPatients(e.target.value)} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`sh-slot-${doctorId}`}>Slot minutes</label>
          <input id={`sh-slot-${doctorId}`} type="number" min={1} className={styles.input} value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} required />
        </div>
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.buttonPrimary} disabled={busy}>
            {editingId ? "Save shift" : "Add shift"}
          </button>
          {editingId && (
            <button type="button" className={styles.buttonSecondary} onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function BreakList({ doctorId, rows, onChange, onError }: { doctorId: string; rows: DoctorBreakRow[]; onChange: () => void; onError: (m: string) => void }) {
  const supabase = createClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [weekday, setWeekday] = useState("1")
  const [startTime, setStartTime] = useState("13:00")
  const [endTime, setEndTime] = useState("14:00")
  const [busy, setBusy] = useState(false)

  function reset() {
    setEditingId(null)
    setWeekday("1")
    setStartTime("13:00")
    setEndTime("14:00")
  }

  function edit(r: DoctorBreakRow) {
    setEditingId(r.id)
    setWeekday(String(r.weekday))
    setStartTime(r.start_time.slice(0, 5))
    setEndTime(r.end_time.slice(0, 5))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.rpc("admin_upsert_doctor_break", {
      p_id: editingId,
      p_doctor_id: doctorId,
      p_weekday: Number(weekday),
      p_start_time: startTime,
      p_end_time: endTime,
    })
    setBusy(false)
    if (error) return onError(describeSupabaseError(error))
    reset()
    onChange()
  }

  async function remove(id: string) {
    if (!confirm("Remove this break?")) return
    const { error } = await supabase.rpc("admin_delete_doctor_break", { p_id: id })
    if (error) return onError(describeSupabaseError(error))
    onChange()
  }

  return (
    <div className={styles.fieldset}>
      <h3 className={styles.label}>Breaks</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Hours</th>
            <th scope="col">
              <span className={styles.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{WEEKDAYS[r.weekday]}</td>
              <td>
                {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
              </td>
              <td>
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} onClick={() => edit(r)}>
                    Edit
                  </button>
                  <button type="button" className={styles.buttonDanger} onClick={() => remove(r.id)}>
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className={styles.emptyCell}>
                No breaks yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label htmlFor={`br-day-${doctorId}`}>Day</label>
          <select id={`br-day-${doctorId}`} className={styles.select} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`br-start-${doctorId}`}>Start</label>
          <input id={`br-start-${doctorId}`} type="time" className={styles.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`br-end-${doctorId}`}>End</label>
          <input id={`br-end-${doctorId}`} type="time" className={styles.input} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.buttonPrimary} disabled={busy}>
            {editingId ? "Save break" : "Add break"}
          </button>
          {editingId && (
            <button type="button" className={styles.buttonSecondary} onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function LeaveList({ doctorId, rows, onChange, onError }: { doctorId: string; rows: DoctorLeaveRow[]; onChange: () => void; onError: (m: string) => void }) {
  const supabase = createClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  function reset() {
    setEditingId(null)
    setFromDate("")
    setToDate("")
    setReason("")
  }

  function edit(r: DoctorLeaveRow) {
    setEditingId(r.id)
    setFromDate(r.from_date)
    setToDate(r.to_date)
    setReason(r.reason ?? "")
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fromDate || !toDate) return onError("From and to dates are required.")
    setBusy(true)
    const { error } = await supabase.rpc("admin_upsert_doctor_leave", {
      p_id: editingId,
      p_doctor_id: doctorId,
      p_from_date: fromDate,
      p_to_date: toDate,
      p_reason: reason.trim() || null,
    })
    setBusy(false)
    if (error) return onError(describeSupabaseError(error))
    reset()
    onChange()
  }

  async function remove(id: string) {
    if (!confirm("Remove this leave?")) return
    const { error } = await supabase.rpc("admin_delete_doctor_leave", { p_id: id })
    if (error) return onError(describeSupabaseError(error))
    onChange()
  }

  return (
    <div className={styles.fieldset}>
      <h3 className={styles.label}>Leaves</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Reason</th>
            <th scope="col">
              <span className={styles.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.from_date}</td>
              <td>{r.to_date}</td>
              <td>{r.reason ?? <span className={styles.cellMuted}>—</span>}</td>
              <td>
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} onClick={() => edit(r)}>
                    Edit
                  </button>
                  <button type="button" className={styles.buttonDanger} onClick={() => remove(r.id)}>
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className={styles.emptyCell}>
                No leaves yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label htmlFor={`lv-from-${doctorId}`}>From</label>
          <input id={`lv-from-${doctorId}`} type="date" className={styles.input} value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`lv-to-${doctorId}`}>To</label>
          <input id={`lv-to-${doctorId}`} type="date" className={styles.input} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`lv-reason-${doctorId}`}>Reason</label>
          <input id={`lv-reason-${doctorId}`} className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.buttonPrimary} disabled={busy}>
            {editingId ? "Save leave" : "Add leave"}
          </button>
          {editingId && (
            <button type="button" className={styles.buttonSecondary} onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
