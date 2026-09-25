import { NextResponse, type NextRequest } from "next/server"

import { roleLandingPath, safeNextPath } from "@/lib/auth/redirect"
import { getMyProfile } from "@/lib/supabase/get-role"
import { createClient } from "@/lib/supabase/server"

// PKCE landing spot for signInWithOAuth({ provider: "google" }) (see
// staff/LoginTabs.tsx). GoTrue redirects here either with `code` (success)
// or `error`/`error_description` (provider not configured, user cancelled,
// etc. -- see supabase/README.md, GOOGLE_ENABLED). Either way this never
// throws a raw error page: a patient who hits this from a dead Google
// integration lands back on /staff's email-code tab instead of a blank
// error screen.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  // Behind Caddy, a route handler's request.url is the container's own
  // http://localhost:3000, so redirects are built on the public origin.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? request.url
  const code = url.searchParams.get("code")
  const rawNext = url.searchParams.get("next")
  const next = safeNextPath(rawNext, "/my")

  if (!code) {
    const fallback = new URL("/staff", base)
    fallback.searchParams.set("tab", "otp")
    fallback.searchParams.set("next", next)
    return NextResponse.redirect(fallback)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    const fallback = new URL("/staff", base)
    fallback.searchParams.set("tab", "otp")
    fallback.searchParams.set("next", next)
    return NextResponse.redirect(fallback)
  }

  const profile = await getMyProfile(supabase, data.user.id)
  const landing = rawNext ? safeNextPath(rawNext, roleLandingPath(profile)) : roleLandingPath(profile)
  return NextResponse.redirect(new URL(landing, base))
}
