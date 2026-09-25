"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"
import styles from "../admin.module.css"

// `short` is what the collapsed (<1024px, see DESIGN.md's tablet
// breakpoint) rail shows in place of the full label -- the design spec
// calls that state "icons," but this app has no icon set, so a short
// text mark stands in rather than reaching for an icon library for six
// glyphs. `label` stays the accessible name at every width.
const LINKS = [
  { href: "/admin", label: "Dashboard", short: "Db" },
  { href: "/admin/services", label: "Services", short: "Sv" },
  { href: "/admin/counters", label: "Counters", short: "Co" },
  { href: "/admin/staff", label: "Staff", short: "St" },
  { href: "/admin/settings", label: "Priority settings", short: "Pr" },
]

export function AdminNav({ orgName }: { orgName: string | null }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <nav className={styles.sidebar} aria-label="Admin">
      <div className={styles.brand}>{orgName ?? "Queueless"}</div>
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            title={link.label}
            aria-label={link.label}
            aria-current={active ? "page" : undefined}
            className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
          >
            <span className={styles.navShort} aria-hidden="true">
              {link.short}
            </span>
            <span className={styles.navLabel}>{link.label}</span>
          </Link>
        )
      })}
      <button type="button" className={styles.signOut} onClick={signOut} title="Sign out" aria-label="Sign out">
        <span className={styles.navShort} aria-hidden="true">
          Out
        </span>
        <span className={styles.navLabel}>Sign out</span>
      </button>
    </nav>
  )
}
