import Link from "next/link"

import { Logo } from "@/components/brand/Logo"

import { PatientSignOut } from "./PatientSignOut"
import styles from "./my.module.css"

// Session + profile-completeness gating already runs in proxy.ts (every
// /my/** request), so this layout is chrome only, not a second gate --
// same split as admin/layout.tsx's own comment about its defense-in-depth
// re-check versus the proxy's real one.
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <Link href="/my" className={styles.brand}>
          <Logo size={22} />
        </Link>
        <PatientSignOut />
      </header>
      <main id="main">{children}</main>
    </div>
  )
}
