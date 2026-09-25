"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useResilientChannel } from "@/lib/realtime/useResilientChannel";

// The two numbers QueueTracker needs that /t/[id] did not already load.

// The service's most recently called token, from the anon-readable
// board_services row the TV board reads (no other patient's row is touched).
// Realtime on that row, plus the same 10s poll + refocus fallback as the rest
// of /t/[id] (QA #1: postgres_changes can go quiet on an open anon tab).
export function useNowServing(serviceId: string, serviceDay: string): string | null {
  const [supabase] = useState(() => createClient());
  const [code, setCode] = useState<string | null>(null);

  const load = useCallback(
    () =>
      supabase
        .from("board_services")
        .select("last_called_code")
        .eq("service_id", serviceId)
        .eq("day", serviceDay)
        .maybeSingle()
        .then(({ data }) => setCode((data as { last_called_code: string | null } | null)?.last_called_code ?? null)),
    [supabase, serviceId, serviceDay],
  );

  useResilientChannel({
    channelName: `tracker-board-${serviceId}`,
    table: "board_services",
    filter: `service_id=eq.${serviceId}`,
    onEvent: load,
  });

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    const refetch = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refetch);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [load]);

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

// The first wait estimate this phone saw for the token, kept per token in
// localStorage so a reload does not reset the ring's 0%. A later, longer
// estimate (a priority arrival) leaves it alone, so the ring can honestly
// fall back. Until something is stored, the current estimate stands in.
export function useEtaAtJoin(tokenId: string, etaMinutes: number | null): number | null {
  const key = `queueless-eta-at-join-${tokenId}`;
  const stored = useSyncExternalStore(noSubscribe, () => readStored(key), () => null);

  useEffect(() => {
    if (stored !== null || !etaMinutes) return;
    try {
      localStorage.setItem(key, String(etaMinutes));
    } catch {}
  }, [key, stored, etaMinutes]);

  return stored ?? etaMinutes;
}
