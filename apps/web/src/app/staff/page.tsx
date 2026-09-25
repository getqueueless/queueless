import { redirect } from "next/navigation"

// Superseded by /login (one unified sign-in card for every role -- see
// login/LoginCard.tsx) -- kept as a redirect so any old link/bookmark to
// /staff still lands somewhere real.
export default async function StaffRedirect({ searchParams }: PageProps<"/staff">) {
  const params = await searchParams
  const next = Array.isArray(params.next) ? params.next[0] : params.next

  const target = new URLSearchParams()
  if (next) target.set("next", next)

  const query = target.toString()
  redirect(query ? `/login?${query}` : "/login")
}
