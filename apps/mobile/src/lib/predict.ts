/** Local fallback estimate used when `GET /predict` is missing, slow, or errors. */
export function estimateWaitSeconds(waitingCount: number, avgServiceSecs: number, openCounters: number): number {
  return Math.round((waitingCount * avgServiceSecs) / Math.max(openCounters, 1));
}

/** Manual/CI sanity check — not run automatically at import time. Call `demo()` yourself to check. */
export function demo() {
  console.assert(estimateWaitSeconds(10, 120, 2) === 600, 'normal case: 10 * 120 / 2 = 600');
  console.assert(estimateWaitSeconds(5, 60, 0) === 300, 'openCounters=0 clamps to 1: 5 * 60 / 1 = 300');
}
