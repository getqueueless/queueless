import { useEffect, useState, useSyncExternalStore } from 'react';

import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';

// The two numbers QueueTracker needs that the token screen did not already load. Mirrors
// apps/web's useQueueExtras.ts.

/**
 * The service's most recently called token code, from the anon-readable board_services row the
 * TV board reads (no other patient's row is touched). Re-read whenever `refreshKey` changes,
 * which the token screen ties to its own refetch (realtime, focus, its 10s poll), so this adds no
 * clock of its own.
 */
export function useNowServing(tokenId: string | undefined, refreshKey: unknown): string | null {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenId) return;
    let cancelled = false;
    supabase
      .from('tokens')
      .select('service_id')
      .eq('id', tokenId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setServiceId((data as { service_id: string } | null)?.service_id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    supabase
      .from('board_services')
      .select('last_called_code')
      .eq('service_id', serviceId)
      .eq('day', todayDateString())
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCode((data as { last_called_code: string | null } | null)?.last_called_code ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId, refreshKey]);

  return code;
}

const noSubscribe = () => () => {};

function readStored(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The first wait estimate this phone saw for the token, kept per token in storage so reopening
 * the screen does not reset the ring's 0%. A later, longer estimate (a priority arrival) leaves it
 * alone, so the ring can honestly fall back. Until something is stored, the current estimate
 * stands in.
 */
export function useEtaAtJoin(tokenId: string | undefined, etaMinutes: number | null): number | null {
  const key = `queueless-eta-at-join-${tokenId}`;
  const stored = useSyncExternalStore(noSubscribe, () => readStored(key), () => null);

  useEffect(() => {
    if (!tokenId || stored !== null || !etaMinutes) return;
    try {
      localStorage.setItem(key, String(etaMinutes));
    } catch {
      // Non-fatal: the ring just measures from the current estimate.
    }
  }, [tokenId, key, stored, etaMinutes]);

  return stored ?? etaMinutes;
}
