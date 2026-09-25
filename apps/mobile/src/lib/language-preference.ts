// Local-only for now: `profiles` has no `language` column or RPC anywhere in
// supabase/migrations/ (checked all 32 files) as of this build — see docs/DECISIONS.md. Mirrors
// theme-preference.ts exactly (same localStorage polyfill, same subscribe pattern) rather than
// inventing a second persistence approach for one more small preference.
export type LanguagePreference = 'en' | 'hi' | 'pa';

const KEY = 'queueless-language-preference';
const listeners = new Set<() => void>();

export const LANGUAGE_LABELS: Record<LanguagePreference, string> = {
  en: 'English',
  hi: 'हिन्दी',
  pa: 'ਪੰਜਾਬੀ',
};

export function getLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'en' || value === 'hi' || value === 'pa') return value;
  } catch {
    // localStorage unavailable — default to English.
  }
  return 'en';
}

export function setLanguagePreference(preference: LanguagePreference): void {
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // Non-fatal — the preference just won't persist across restarts this run.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeLanguagePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
