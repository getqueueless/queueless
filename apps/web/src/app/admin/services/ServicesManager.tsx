"use client"

import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { describeSupabaseError } from "../_lib/describe-error"
import type { ServiceRow } from "../_lib/types"
import styles from "../admin.module.css"

type FormState = {
  code: string
  name: string
  is_open: boolean
  default_service_secs: string
  no_show_minutes: string
  max_tokens_per_day: string
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  is_open: true,
  default_service_secs: "300",
  no_show_minutes: "5",
  max_tokens_per_day: "500",
}

function toForm(s: ServiceRow): FormState {
  return {
    code: s.code,
    name: s.name,
    is_open: s.is_open,
    default_service_secs: String(s.default_service_secs),
    no_show_minutes: String(s.no_show_minutes),
    max_tokens_per_day: String(s.max_tokens_per_day),
  }
}

export function ServicesManager({ initialServices, orgId }: { initialServices: ServiceRow[]; orgId: string | null }) {
  const [services, setServices] = useState(initialServices)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  async function refresh() {
    const { data } = await supabase
      .from("services")
      .select("id, org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day")
      .order("name")
    if (data) setServices(data as ServiceRow[])
  }

  function startEdit(s: ServiceRow) {
    setEditingId(s.id)
    setForm(toForm(s))
    setError(null)
  }

  function startCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.")
      return
    }
    if (form.code.trim().length > 3) {
      setError("Code must be 3 characters or fewer.")
      return
    }

    setBusy(true)
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      is_open: form.is_open,
      default_service_secs: Number(form.default_service_secs) || 0,
      no_show_minutes: Number(form.no_show_minutes) || 0,
      max_tokens_per_day: Number(form.max_tokens_per_day) || 0,
    }

    const { error } = editingId
      ? await supabase.from("services").update(payload).eq("id", editingId)
      : await supabase.from("services").insert({ ...payload, org_id: orgId })

    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    await refresh()
    startCreate()
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this service? This can't be undone.")) return
    setBusy(true)
    const { error } = await supabase.from("services").delete().eq("id", id)
    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    await refresh()
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {error && <div className={`${styles.banner} ${styles.bannerDanger}`}>{error}</div>}

      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Default service</th>
              <th scope="col">No-show after</th>
              <th scope="col">Daily cap</th>
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td>
                <td>{s.name}</td>
                <td>
                  <span className={s.is_open ? `${styles.badge} ${styles.badgeSuccess}` : `${styles.badge} ${styles.badgeMuted}`}>
                    {s.is_open ? "Open" : "Closed"}
                  </span>
                </td>
                <td>{s.default_service_secs}s</td>
                <td>{s.no_show_minutes}m</td>
                <td>{s.max_tokens_per_day}</td>
                <td>
                  <div className={styles.buttonRow}>
                    <button type="button" className={styles.buttonSecondary} onClick={() => startEdit(s)}>
                      Edit
                    </button>
                    <button type="button" className={styles.buttonDanger} onClick={() => onDelete(s.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "var(--color-ink-muted)" }}>
                  No services yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.card}>
        <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
          {editingId ? "Edit service" : "New service"}
        </div>
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="svc-code">Code (max 3 chars)</label>
            <input
              id="svc-code"
              className={styles.input}
              value={form.code}
              maxLength={3}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="svc-name">Name</label>
            <input id="svc-name" className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.is_open} onChange={(e) => setForm({ ...form, is_open: e.target.checked })} />
            Open for new tokens
          </label>
          <div className={styles.field}>
            <label htmlFor="svc-secs">Default service time (seconds)</label>
            <input
              id="svc-secs"
              type="number"
              min={0}
              className={styles.input}
              value={form.default_service_secs}
              onChange={(e) => setForm({ ...form, default_service_secs: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="svc-noshow">No-show after (minutes)</label>
            <input
              id="svc-noshow"
              type="number"
              min={0}
              className={styles.input}
              value={form.no_show_minutes}
              onChange={(e) => setForm({ ...form, no_show_minutes: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="svc-cap">Max tokens per day</label>
            <input
              id="svc-cap"
              type="number"
              min={0}
              className={styles.input}
              value={form.max_tokens_per_day}
              onChange={(e) => setForm({ ...form, max_tokens_per_day: e.target.value })}
            />
          </div>
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.buttonPrimary} disabled={busy}>
              {editingId ? "Save changes" : "Create service"}
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
