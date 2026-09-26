import Link from "next/link"
import { BackButton } from "@/components/site/BackButton"
import { Suspense } from "react"

import { Logo } from "@/components/brand/Logo"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { loadLiveToken } from "@/components/tokens/active-token"
import { ActiveTokenBar } from "@/components/tokens/ActiveTokenBar"
import { createClient } from "@/lib/supabase/server"

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
        <BackButton />
        <Link href="/my" className={styles.brand}>
          <Logo size={22} />
        </Link>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <PatientSignOut />
        </div>
      </header>
      <Suspense fallback={null}>
        <LiveTokenBar />
      </Suspense>
      <main id="main" className={styles.main}>{children}</main>
    </div>
  )
}

// Streams in after the chrome; renders nothing when there is no active token.
async function LiveTokenBar() {
  const live = await loadLiveToken(await createClient())
  return <ActiveTokenBar key={live?.token.id ?? "none"} initial={live} />
}
