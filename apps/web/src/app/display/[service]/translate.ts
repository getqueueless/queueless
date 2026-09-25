// Client for the API agent's FastAPI POST /translate route
// (apps/api/app/routes/ai.py). Same "never throw, degrade to null" contract
// as apps/web/src/app/t/[id]/predict.ts.
//
// NOTE: that route is gated behind `require_role("staff", "admin")` -- a
// Bearer token from a signed-in staff/admin session. This board is public
// and intentionally unauthenticated (see page.tsx), so it has no session to
// draw a token from and never sends an Authorization header. Every call
// here is therefore expected to come back 403 until the API grows an
// anon-safe path (or this board grows a way to hold a scoped token, which is
// out of this route's scope). That is fine: the caller (display-board.tsx)
// treats a null return exactly like a slow/broken translate call and falls
// back to the plain English announcement, which is the required behavior
// either way -- it just means the "translated" branch will not fire in
// practice yet. Flagged here rather than silently shipped as if it worked.
export async function fetchTranslation(text: string, targetLang: "hi" | "pa"): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!base) return null
  try {
    const res = await fetch(`${base}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_lang: targetLang }),
      // Never let a hung translate call hold up the spoken announcement for long.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { translated?: unknown }
    return typeof data.translated === "string" ? data.translated : null
  } catch {
    return null
  }
}
