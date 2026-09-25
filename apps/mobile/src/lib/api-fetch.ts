// Authenticated client for apps/api's admin routes (e.g. POST /admin/refunds) -- those need
// require_org_role("admin") on the FastAPI side, so the caller's own Supabase session JWT goes
// in the Authorization header. Same shape as apps/web/src/app/admin/_lib/api-fetch.ts.

import { supabase } from './supabase';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return { ok: false, message: 'API is not configured.' };

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return { ok: false, message: 'Not signed in.' };

  try {
    const res = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body && typeof body.detail === 'string' ? body.detail : `Request failed (${res.status})`;
      return { ok: false, message };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, message: "Couldn't reach the server." };
  }
}
