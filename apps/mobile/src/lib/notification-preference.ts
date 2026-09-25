import { useSyncExternalStore } from 'react';

// Queue alerts on/off, stored like the other small preferences (theme, language, elderly mode).
// Default on. lib/notifications.ts reads it before registering for push or showing an alert.
const KEY = 'queueless-alerts';
const listeners = new Set<() => void>();

export function getAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAlertsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    // Non-fatal: the choice just won't survive a restart.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAlertsEnabled(): boolean {
  return useSyncExternalStore(subscribe, getAlertsEnabled, () => true);
}
