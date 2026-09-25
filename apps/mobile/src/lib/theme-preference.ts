export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'queueless-theme-preference';
const listeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // localStorage unavailable — default to system.
  }
  return 'system';
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // Non-fatal — the preference just won't persist across restarts this run.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
