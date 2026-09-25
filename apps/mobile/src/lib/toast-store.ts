// Same plain module-store shape as theme-preference.ts, not a Context provider -- a toast has no
// per-screen state to scope, any screen can call showToast() directly. Replaces Alert.alert for
// non-blocking confirmations (Alert has no web implementation, confirmed against expo start --web
// earlier this session -- see docs/DECISIONS.md).
export type ToastTone = 'default' | 'success' | 'error';
export type ToastState = { id: number; message: string; tone: ToastTone } | null;

const DURATION_MS = 2600;
const listeners = new Set<() => void>();
let state: ToastState = null;
let nextId = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function getToast(): ToastState {
  return state;
}

export function showToast(message: string, tone: ToastTone = 'default'): void {
  if (hideTimer) clearTimeout(hideTimer);
  state = { id: nextId++, message, tone };
  listeners.forEach((listener) => listener());
  hideTimer = setTimeout(() => {
    state = null;
    listeners.forEach((listener) => listener());
  }, DURATION_MS);
}

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
