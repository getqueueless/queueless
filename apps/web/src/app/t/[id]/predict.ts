// Best-effort bridge from a `services` row to the FastAPI /predict service's
// fixed 5-slug preset (apps/api/app/routes/predict.py). There's no seed data
// or shared enum yet tying services.code/name to that Literal, so this
// guesses from the name/code text. If nothing matches, callers skip the ETA
// card instead of guessing further -- see the report for the real fix.
export type PredictSlug = "general_opd" | "pediatrics" | "ortho" | "dental" | "eye"

const ALIASES: Array<[RegExp, PredictSlug]> = [
  [/pediatric/i, "pediatrics"],
  [/ortho/i, "ortho"],
  [/dental|dentist/i, "dental"],
  [/eye|ophthal/i, "eye"],
  [/general/i, "general_opd"],
]

export function mapServiceToPredictSlug(service: { name: string; code: string }): PredictSlug | null {
  for (const [pattern, slug] of ALIASES) {
    if (pattern.test(service.name) || pattern.test(service.code)) return slug
  }
  return null
}

export type Prediction = { predictedWaitMinutes: number; fallback: boolean }

// ponytail: hour/weekday read the caller's own clock (server clock on first
// load, visitor's browser clock on later refreshes) rather than the org's
// timezone (organizations.timezone) -- fine for a same-timezone hackathon
// demo; add an org-timezone lookup if this ever runs across timezones.
export async function fetchPrediction(
  slug: PredictSlug,
  queueLenAhead: number,
  countersOpen: number,
): Promise<Prediction | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!base) return null
  const now = new Date()
  try {
    const res = await fetch(`${base}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: slug,
        hour: now.getHours(),
        weekday: now.getDay(),
        queue_len_ahead: queueLenAhead,
        counters_open: countersOpen,
      }),
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data.predicted_wait_minutes !== "number") return null
    return { predictedWaitMinutes: data.predicted_wait_minutes, fallback: Boolean(data.fallback) }
  } catch {
    return null
  }
}
