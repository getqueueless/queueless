import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

export const LIVE_POLL_MS = 15_000;

/**
 * Refetch when the screen gains focus, then every `intervalMs` (default 15 s) while it stays
 * focused. Realtime postgres_changes on these screens can silently miss events (RLS,
 * reconnects), so this is the floor that keeps staff/admin/patient screens honest. `refetch`
 * must be stable (useCallback).
 * ponytail: plain polling; switch to the DB broadcast topics once docs/API_CONTRACT.md lists them.
 */
export function useLiveRefresh(refetch: () => unknown, intervalMs: number = LIVE_POLL_MS) {
  useFocusEffect(
    useCallback(() => {
      refetch();
      const id = setInterval(refetch, intervalMs);
      return () => clearInterval(id);
    }, [refetch, intervalMs]),
  );
}
