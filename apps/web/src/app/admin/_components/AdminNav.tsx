"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"
import styles from "../admin.module.css"

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/services", label: "Services" },
  { href: "/admin/counters", label: "Counters" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/settings", label: "Priority settings" },
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
            className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
          >
            <span className={styles.navLabel}>{link.label}</span>
          </Link>
        )
      })}
      <button type="button" className={styles.signOut} onClick={signOut}>
        <span className={styles.navLabel}>Sign out</span>
      </button>
    </nav>
  )
}
