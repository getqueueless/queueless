// Client for the API agent's FastAPI /predict route (apps/api/app/routes/predict.py).
// service_id is the real `services.id` UUID -- the route validates it exists in
// today's board_services and returns a model estimate or documented fallback,
// so any real service can be sent directly (no client-side slug guessing).

export type Prediction = { predictedWaitMinutes: number; fallback: boolean }

// ponytail: hour/weekday read the caller's own clock (server clock on first
// load, visitor's browser clock on later refreshes) rather than the org's
// timezone (organizations.timezone) -- fine for a same-timezone hackathon
// demo; add an org-timezone lookup if this ever runs across timezones.
export async function fetchPrediction(
  serviceId: string,
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
        service_id: serviceId,
        hour: now.getHours(),
        weekday: (now.getDay() + 6) % 7, // JS: 0=Sun -> API: 0=Mon
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
