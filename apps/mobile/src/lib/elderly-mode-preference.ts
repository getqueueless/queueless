// Mirrors theme-preference.ts / language-preference.ts exactly (same localStorage polyfill,
// same subscribe pattern) rather than inventing a third persistence approach for one more
// small preference. Scales patient-facing text 1.3x when on -- see use-text-scale.ts.
const KEY = 'queueless-elderly-mode';
const listeners = new Set<() => void>();

export const ELDERLY_MODE_SCALE = 1.3;

export function getElderlyMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // localStorage unavailable — default off.
    return false;
  }
}

export function setElderlyMode(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    // Non-fatal — the preference just won't persist across restarts this run.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeElderlyMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
