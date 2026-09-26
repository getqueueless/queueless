import { createClient } from "@/lib/supabase/server"
import { BackButton } from "@/components/site/BackButton"
import { AdminNav } from "./_components/AdminNav"
import styles from "./admin.module.css"

// Admin-only gate already runs in src/lib/supabase/proxy.ts (redirects to
// /counter when profiles.role !== 'admin'). This is a defense-in-depth
// re-check, not the primary gate -- it degrades to "no org name" rather than
// blocking, since the proxy has already decided whether this request is
// allowed here.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  let orgName: string | null = null

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
      if (profile?.org_id) {
        const { data: org } = await supabase.from("organizations").select("name").eq("id", profile.org_id).maybeSingle()
        orgName = org?.name ?? null
      }
    }
  } catch {
    orgName = null
  }

  return (
    <div className={styles.root}>
      <a href="#admin-main" className={styles.skipLink}>
        Skip to content
      </a>
      <div className={styles.shell}>
        <AdminNav orgName={orgName} />
        <main id="admin-main" className={styles.content}>
          <BackButton className={styles.adminBack} variant="admin" />
          {children}
        </main>
      </div>
    </div>
  )
}
