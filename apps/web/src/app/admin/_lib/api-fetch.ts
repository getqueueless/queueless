// Authenticated client for apps/api's admin routes (/admin/ask,
// /admin/summary*) -- unlike predict.ts's public /predict, these need
// require_org_role("admin") on the FastAPI side, so the caller's own
// Supabase session JWT goes in the Authorization header.

import { createClient } from "@/lib/supabase/client"

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string }

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!apiBaseUrl) return { ok: false, status: null, message: "NEXT_PUBLIC_API_BASE_URL is not configured" }

  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { ok: false, status: 401, message: "Not signed in." }

  try {
    const res = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const message = (body && typeof body.detail === "string" ? body.detail : null) ?? `Request failed (${res.status})`
      return { ok: false, status: res.status, message }
    }
    return { ok: true, data: body as T }
  } catch {
    return { ok: false, status: null, message: "Couldn't reach the AI service." }
  }
}
