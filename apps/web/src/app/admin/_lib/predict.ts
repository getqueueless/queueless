// Client for the API agent's FastAPI /predict route (apps/api/app/routes/predict.py).
// Must never throw into a render -- every caller gets back a tagged result and
// degrades to "prediction not available" instead of crashing the dashboard.

// Mirrors the `Service` Literal in apps/api/app/routes/predict.py and the
// BASE_MINUTES keys in apps/api/scripts/generate_training_data.py. The demo
// preset's 5 services are fixed; there is no live discovery endpoint for
// them, so this list is hand-kept in sync with the API agent's code.
const PREDICT_SERVICES = ["general_opd", "pediatrics", "ortho", "dental", "eye"] as const
type PredictService = (typeof PREDICT_SERVICES)[number]

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

// The DB agent's `services.code`/`.name` values aren't guaranteed to match
// the API agent's Service slugs (no shared enum lands them together yet) --
// best-effort match by slugified name, then by code, else give up gracefully.
export function matchPredictService(service: { code: string; name: string }): PredictService | null {
  const bySlug = slugify(service.name)
  if ((PREDICT_SERVICES as readonly string[]).includes(bySlug)) return bySlug as PredictService
  const byCode = slugify(service.code)
  if ((PREDICT_SERVICES as readonly string[]).includes(byCode)) return byCode as PredictService
  return null
}

export type PredictResult =
  | { ok: true; predictedWaitMinutes: number; fallback: boolean }
  | { ok: false; reason: string }

export async function fetchPredictedWait(
  apiBaseUrl: string | undefined,
  args: { service: PredictService; hour: number; weekday: number; queueLenAhead: number; countersOpen: number },
): Promise<PredictResult> {
  if (!apiBaseUrl) return { ok: false, reason: "NEXT_PUBLIC_API_BASE_URL is not configured" }

  try {
    const res = await fetch(`${apiBaseUrl}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: args.service,
        hour: args.hour,
        weekday: args.weekday,
        queue_len_ahead: args.queueLenAhead,
        counters_open: args.countersOpen,
      }),
      // Demo runs on a shared box; don't let a hung request stall the chart.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { ok: false, reason: `API returned ${res.status}` }
    const body = (await res.json()) as { predicted_wait_minutes: number; fallback: boolean }
    return { ok: true, predictedWaitMinutes: body.predicted_wait_minutes, fallback: body.fallback }
  } catch {
    return { ok: false, reason: "prediction service unreachable" }
  }
}
