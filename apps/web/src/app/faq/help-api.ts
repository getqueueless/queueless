// Client for apps/api's help endpoints (GET /help/faq, POST /help/ask).
// Normalised here, so the page only ever sees one shape.

// Same FastAPI base the /predict client uses; api.lpu.lol when unset.
export const HELP_API = `${process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.lpu.lol"}/help`

export const CATEGORIES = [
  { key: "patients", label: "Patients" },
  { key: "payments", label: "Payments & refunds" },
  { key: "staff", label: "Staff" },
  { key: "admin", label: "Admin" },
  { key: "privacy", label: "Privacy & security" },
  { key: "app", label: "App install" },
] as const

export type CategoryKey = (typeof CATEGORIES)[number]["key"] | "other"
export type FaqItem = { id: string; category: CategoryKey; question: string; answer: string }

// "Payments & refunds", "payments_refunds", "payments" all land on one key.
function categoryKey(raw: unknown): CategoryKey {
  const text = String(raw ?? "").toLowerCase()
  if (text.includes("pay") || text.includes("refund")) return "payments"
  if (text.includes("privacy") || text.includes("security")) return "privacy"
  if (text.includes("install") || text.includes("app")) return "app"
  if (text.includes("admin")) return "admin"
  if (text.includes("staff") || text.includes("counter")) return "staff"
  if (text.includes("patient")) return "patients"
  return "other"
}

type Raw = Record<string, unknown>

export function normaliseFaq(data: unknown): FaqItem[] {
  const list = Array.isArray(data)
    ? data
    : ((data as Raw | null)?.items ?? (data as Raw | null)?.faqs ?? (data as Raw | null)?.faq ?? [])
  if (!Array.isArray(list)) return []
  return list
    .map((raw: Raw, i: number) => ({
      id: String(raw.id ?? raw.slug ?? `q${i + 1}`),
      category: categoryKey(raw.category ?? raw.section),
      question: String(raw.question ?? raw.q ?? raw.title ?? ""),
      answer: String(raw.answer ?? raw.a ?? raw.body ?? ""),
    }))
    .filter((item) => item.question && item.answer)
}

// Server-side, cached 5 minutes; null when the API is down.
export async function fetchFaq(): Promise<FaqItem[] | null> {
  try {
    const res = await fetch(`${HELP_API}/faq`, { next: { revalidate: 300 } })
    if (!res.ok) return null
    const items = normaliseFaq(await res.json())
    return items.length ? items : null
  } catch {
    return null
  }
}

export type AskResult =
  | { kind: "answer"; answer: string; ai: boolean; sources: { id: string; title: string }[] }
  | { kind: "rate_limited" }
  | { kind: "error" }

export function parseAsk(status: number, data: unknown): AskResult {
  const body = (data ?? {}) as Raw
  if (status === 429 || body.error === "rate_limited" || body.code === "rate_limited") return { kind: "rate_limited" }
  const answer = body.answer ?? body.text
  if (status >= 400 || typeof answer !== "string" || !answer) return { kind: "error" }
  const raw = (body.sources ?? body.based_on ?? body.basedOn ?? []) as unknown[]
  const sources = Array.isArray(raw)
    ? raw
        .map((s) =>
          typeof s === "string"
            ? { id: s, title: s }
            : { id: String((s as Raw).id ?? (s as Raw).slug ?? ""), title: String((s as Raw).title ?? (s as Raw).question ?? "") },
        )
        .filter((s) => s.id || s.title)
    : []
  return { kind: "answer", answer, ai: body.ai_generated === true, sources }
}
