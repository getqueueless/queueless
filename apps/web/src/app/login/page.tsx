import { redirect } from "next/navigation"

// Superseded by /staff (one combined Google/OTP/password sign-in, see
// staff/page.tsx) -- kept as a redirect so any old link/bookmark still
// lands somewhere real, with ?tab=password since anyone who bookmarked
// /login specifically was signing in as staff.
export default async function LoginRedirect({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const next = Array.isArray(params.next) ? params.next[0] : params.next

  const target = new URLSearchParams({ tab: "password" })
  if (next) target.set("next", next)

  redirect(`/staff?${target.toString()}`)
}
