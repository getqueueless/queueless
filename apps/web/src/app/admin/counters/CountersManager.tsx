"use client"

import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { describeSupabaseError } from "../_lib/describe-error"
import type { CounterRow, CounterState, ServiceRow } from "../_lib/types"
import styles from "../admin.module.css"

type Staff = { id: string; full_name: string | null }
type Link = { counter_id: string; service_id: string }

type FormState = {
  name: string
  state: CounterState
  staff_id: string
  serviceIds: string[]
}

const EMPTY_FORM: FormState = { name: "", state: "closed", staff_id: "", serviceIds: [] }

export function CountersManager({
  initialCounters,
  services,
  initialLinks,
  staff,
  orgId,
}: {
  initialCounters: CounterRow[]
  services: ServiceRow[]
  initialLinks: Link[]
  staff: Staff[]
  orgId: string | null
}) {
  const [counters, setCounters] = useState(initialCounters)
  const [links, setLinks] = useState(initialLinks)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  async function refresh() {
    const [c, l] = await Promise.all([
      supabase.from("counters").select("id, org_id, name, state, staff_id").order("name"),
      supabase.from("counter_services").select("counter_id, service_id"),
    ])
    if (c.data) setCounters(c.data as CounterRow[])
    if (l.data) setLinks(l.data as Link[])
  }

  function startEdit(c: CounterRow) {
    setEditingId(c.id)
    setForm({
      name: c.name,
      state: c.state,
      staff_id: c.staff_id ?? "",
      serviceIds: links.filter((l) => l.counter_id === c.id).map((l) => l.service_id),
    })
    setError(null)
  }

  function startCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  function toggleService(id: string) {
    setForm((f) => ({
      ...f,
      serviceIds: f.serviceIds.includes(id) ? f.serviceIds.filter((s) => s !== id) : [...f.serviceIds, id],
    }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) {
      setError("Name is required.")
      return
    }

    setBusy(true)
    const payload = { name: form.name.trim(), state: form.state, staff_id: form.staff_id || null }

    const { data: saved, error } = editingId
      ? await supabase.from("counters").update(payload).eq("id", editingId).select("id").single()
      : await supabase.from("counters").insert({ ...payload, org_id: orgId }).select("id").single()

    if (error || !saved) {
      setBusy(false)
      setError(describeSupabaseError(error))
      return
    }

    const counterId = saved.id as string
    // Simplest correct way to sync a small join table: replace the set.
    const del = await supabase.from("counter_services").delete().eq("counter_id", counterId)
    if (del.error) {
      setBusy(false)
      setError(describeSupabaseError(del.error))
      return
    }
    if (form.serviceIds.length > 0) {
      const ins = await supabase.from("counter_services").insert(form.serviceIds.map((service_id) => ({ counter_id: counterId, service_id })))
      if (ins.error) {
        setBusy(false)
        setError(describeSupabaseError(ins.error))
        return
      }
    }

    setBusy(false)
    await refresh()
    startCreate()
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this counter? This can't be undone.")) return
    setBusy(true)
    const { error } = await supabase.from("counters").delete().eq("id", id)
    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    await refresh()
  }

  function serviceNames(counterId: string): string {
    const ids = links.filter((l) => l.counter_id === counterId).map((l) => l.service_id)
    const names = services.filter((s) => ids.includes(s.id)).map((s) => s.code)
    return names.length ? names.join(", ") : "—"
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {error && <div className={`${styles.banner} ${styles.bannerDanger}`}>{error}</div>}

      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th>Staff</th>
              <th>Services</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {counters.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <span
                    className={
                      c.state === "open"
                        ? `${styles.badge} ${styles.badgeSuccess}`
                        : c.state === "paused"
                          ? `${styles.badge} ${styles.badgeWarning}`
                          : `${styles.badge} ${styles.badgeMuted}`
                    }
                  >
                    {c.state}
                  </span>
                </td>
                <td>{staff.find((s) => s.id === c.staff_id)?.full_name ?? "—"}</td>
                <td>{serviceNames(c.id)}</td>
                <td>
                  <div className={styles.buttonRow}>
                    <button type="button" className={styles.buttonSecondary} onClick={() => startEdit(c)}>
                      Edit
                    </button>
                    <button type="button" className={styles.buttonDanger} onClick={() => onDelete(c.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {counters.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--color-ink-muted)" }}>
                  No counters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.card}>
        <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
          {editingId ? "Edit counter" : "New counter"}
        </div>
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="ctr-name">Name</label>
            <input id="ctr-name" className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="ctr-state">State</label>
            <select id="ctr-state" className={styles.select} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value as CounterState })}>
              <option value="closed">Closed</option>
              <option value="open">Open</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="ctr-staff">Staff</label>
            <select id="ctr-staff" className={styles.select} value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name ?? s.id}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Handles services</label>
            {services.map((s) => (
              <label key={s.id} className={styles.checkboxRow}>
                <input type="checkbox" checked={form.serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.buttonPrimary} disabled={busy}>
              {editingId ? "Save changes" : "Create counter"}
            </button>
            {editingId && (
              <button type="button" className={styles.buttonSecondary} onClick={startCreate}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
