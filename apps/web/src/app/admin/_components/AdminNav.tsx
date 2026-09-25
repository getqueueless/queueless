"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { Logo, LogoMark } from "@/components/brand/Logo"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { createClient } from "@/lib/supabase/client"
import styles from "../admin.module.css"

// Stroke icons on a 24px grid. The collapsed (<1024px, see DESIGN.md's
// tablet breakpoint) rail shows only these; `label` stays the accessible
// name at every width.
const LINKS = [
  { href: "/admin", label: "Dashboard", icon: <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" /> },
  {
    href: "/admin/services",
    label: "Services",
    icon: <path d="M9 4h6v3H9zM8 5.5H6.5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H16M9 12h6M9 16h4" />,
  },
  { href: "/admin/counters", label: "Counters", icon: <path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 20h8M12 16v4" /> },
  {
    href: "/admin/staff",
    label: "Staff",
    icon: <path d="M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20a6 6 0 0 1 12 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4a6 6 0 0 1 3 5.6" />,
  },
  {
    href: "/admin/settings",
    label: "Priority settings",
    icon: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  },
]

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function AdminNav({ orgName }: { orgName: string | null }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/staff?tab=password")
  }

  return (
    <nav className={styles.sidebar} aria-label="Admin" data-surface="slate">
      <div className={styles.sidebarInner}>
        <div className={styles.brand}>
          {/* Wrapped: Logo sets display inline, which would beat the rail's display:none. */}
          <span className={styles.brandFull}>
            <Logo size={22} />
          </span>
          <LogoMark size={24} className={styles.brandMark} />
          {orgName && <div className={styles.brandOrg}>{orgName}</div>}
        </div>
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
              <Icon>{link.icon}</Icon>
              <span className={styles.navLabel}>{link.label}</span>
            </Link>
          )
        })}
        <div className={styles.sidebarFoot}>
          <button type="button" className={styles.signOut} onClick={signOut} title="Sign out" aria-label="Sign out">
            <Icon>
              <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9" />
            </Icon>
            <span className={styles.navLabel}>Sign out</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}
