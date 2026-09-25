// Client for the API agent's FastAPI /predict route (apps/api/app/routes/predict.py).
// Must never throw into a render -- every caller gets back a tagged result and
// degrades to "prediction not available" instead of crashing the dashboard.
//
// service_id is the real `services.id` UUID. The route no longer takes a fixed
// slug enum (see docs/api/model-card.md) -- it validates the id against
// today's board_services and returns a model estimate or a documented
// low-confidence fallback, so any real service can be sent directly.

export type PredictResult =
  | { ok: true; predictedWaitMinutes: number; fallback: boolean }
  | { ok: false; reason: string }

export async function fetchPredictedWait(
  apiBaseUrl: string | undefined,
  args: { serviceId: string; hour: number; weekday: number; queueLenAhead: number; countersOpen: number },
): Promise<PredictResult> {
  if (!apiBaseUrl) return { ok: false, reason: "NEXT_PUBLIC_API_BASE_URL is not configured" }

  try {
    const res = await fetch(`${apiBaseUrl}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: args.serviceId,
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
