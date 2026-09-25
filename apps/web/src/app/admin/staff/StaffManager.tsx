"use client"

import { useEffect, useState } from "react"

import styles from "../admin.module.css"

type StaffProfile = {
  id: string
  role: "patient" | "staff" | "admin"
  full_name: string | null
  phone: string | null
  created_at: string
}

const EMPTY_FORM = { email: "", full_name: "", role: "staff" as "staff" | "admin" }

export function StaffManager() {
  const [staff, setStaff] = useState<StaffProfile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch("/api/admin/staff")
      const body = await res.json()
      if (!res.ok) {
        setLoadError(body.error ?? `Request failed (${res.status})`)
        return
      }
      setStaff(body.staff)
      setLoadError(null)
    } catch {
      setLoadError("Couldn't reach the server.")
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    load()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const body = await res.json()
      if (!res.ok) {
        setFormError(body.error ?? `Request failed (${res.status})`)
        return
      }
      setForm(EMPTY_FORM)
      await load()
    } catch {
      setFormError("Couldn't reach the server.")
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(id: string, role: StaffProfile["role"]) {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role }),
      })
      const body = await res.json()
      if (!res.ok) {
        setFormError(body.error ?? `Request failed (${res.status})`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function removeStaff(id: string) {
    if (!confirm("Remove this person's staff/admin access? They'll go back to a normal patient account.")) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/staff?id=${id}`, { method: "DELETE" })
      const body = await res.json()
      if (!res.ok) {
        setFormError(body.error ?? `Request failed (${res.status})`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {loadError && <div className={`${styles.banner} ${styles.bannerDanger}`}>{loadError}</div>}

      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(staff ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.full_name ?? "—"}</td>
                <td>
                  <select
                    className={styles.select}
                    value={s.role}
                    disabled={busy}
                    onChange={(e) => changeRole(s.id, e.target.value as StaffProfile["role"])}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
                <td>
                  <button type="button" className={styles.buttonDanger} onClick={() => removeStaff(s.id)} disabled={busy}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {staff && staff.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "var(--color-ink-muted)" }}>
                  No staff yet.
                </td>
              </tr>
            )}
            {!staff && !loadError && (
              <tr>
                <td colSpan={4} style={{ color: "var(--color-ink-muted)" }}>
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.card}>
        <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
          Add staff
        </div>
        {formError && <div className={`${styles.banner} ${styles.bannerDanger}`}>{formError}</div>}
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="staff-email">Email</label>
            <input
              id="staff-email"
              type="email"
              className={styles.input}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="staff-name">Full name</label>
            <input
              id="staff-name"
              className={styles.input}
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="staff-role">Role</label>
            <select
              id="staff-role"
              className={styles.select}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "staff" | "admin" })}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.buttonPrimary} disabled={busy}>
              Create staff account
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
