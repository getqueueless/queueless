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

// "26 Sept 2026" in the viewer's locale, not an ambiguous 26/09/2026.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

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
    <div className={styles.stack}>
      {loadError && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {loadError}
        </div>
      )}

      {/* Without a list there is nothing to tabulate; the alert above says why. */}
      {(staff || !loadError) && (
        <div className={styles.card}>
          <table className={styles.table} aria-busy={!staff || undefined}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(staff ?? []).map((s) => {
                const who = s.full_name ?? "unnamed staff member"
                return (
                  <tr key={s.id}>
                    <td>{s.full_name ?? <span className={styles.cellMuted}>No name set</span>}</td>
                    <td>
                      <select
                        name="role"
                        aria-label={`Role for ${who}`}
                        className={styles.select}
                        value={s.role}
                        disabled={busy}
                        onChange={(e) => changeRole(s.id, e.target.value as StaffProfile["role"])}
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{DATE_FORMAT.format(new Date(s.created_at))}</td>
                    <td>
                      <div className={styles.buttonRow}>
                        <button type="button" className={styles.buttonDanger} onClick={() => removeStaff(s.id)} disabled={busy}>
                          Remove<span className={styles.srOnly}> {who}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {staff && staff.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.emptyCell}>
                    No staff yet. Create the first account with the form below.
                  </td>
                </tr>
              )}
              {!staff && (
                <tr>
                  <td colSpan={4} className={styles.emptyCell}>
                    Loading staff…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <section className={styles.card} aria-labelledby="staff-form-title">
        <h2 id="staff-form-title" className={styles.cardTitle}>
          Add staff
        </h2>
        {formError && (
          <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
            {formError}
          </div>
        )}
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="staff-email">Email</label>
            <input
              id="staff-email"
              name="email"
              type="email"
              autoComplete="off"
              spellCheck={false}
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
              name="full_name"
              autoComplete="off"
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
              name="role"
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
      </section>
    </div>
  )
}
