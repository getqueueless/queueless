import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

export const LIVE_POLL_MS = 15_000;

/**
 * Refetch when the screen gains focus, then every 15 s while it stays focused. Realtime
 * postgres_changes on these screens can silently miss events (RLS, reconnects), so this is the
 * floor that keeps staff/admin screens honest. `refetch` must be stable (useCallback).
 * ponytail: plain polling; switch to the DB broadcast topics once docs/API_CONTRACT.md lists them.
 */
export function useLiveRefresh(refetch: () => unknown) {
  useFocusEffect(
    useCallback(() => {
      refetch();
      const id = setInterval(refetch, LIVE_POLL_MS);
      return () => clearInterval(id);
    }, [refetch]),
  );
}
