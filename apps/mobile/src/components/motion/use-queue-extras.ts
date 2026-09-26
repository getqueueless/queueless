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

export type ShiftPause = { kind: 'before' | 'between'; doctorName: string; at: string };

const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const clock12 = (min: number) => {
  const h = Math.floor(min / 60);
  return `${((h + 11) % 12) + 1}:${String(min % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
// IST is a fixed UTC+05:30, so no Intl is needed for "now" or today's weekday.
const istNow = () => new Date(Date.now() + 330 * 60_000);
const istMinutes = () => istNow().getUTCHours() * 60 + istNow().getUTCMinutes();

/**
 * For a token with a doctor: whether that doctor's queue hasn't started yet today ('before' the
 * first shift) or is paused between shifts, and when it (re)starts. null while a shift is on, after
 * the last one, or when the token has no doctor. Re-evaluated on every render, and the token
 * screen re-renders on each of its refetches, so it flips back to the live view by itself.
 */
export function useShiftPause(tokenId: string | undefined): ShiftPause | null {
  const [doc, setDoc] = useState<{ name: string; shifts: [number, number][] } | null>(null);

  useEffect(() => {
    if (!tokenId) return;
    let cancelled = false;
    (async () => {
      const { data: token } = await supabase.from('tokens').select('doctor_id').eq('id', tokenId).maybeSingle();
      const doctorId = (token as { doctor_id: string | null } | null)?.doctor_id;
      if (!doctorId) return;
      const [doctor, schedule] = await Promise.all([
        supabase.from('doctors').select('name').eq('id', doctorId).maybeSingle(),
        supabase
          .from('doctor_schedules')
          .select('start_time, end_time')
          .eq('doctor_id', doctorId)
          .eq('weekday', istNow().getUTCDay())
          .order('start_time'),
      ]);
      const name = (doctor.data as { name: string } | null)?.name;
      if (cancelled || !name) return;
      const rows = (schedule.data ?? []) as { start_time: string; end_time: string }[];
      setDoc({ name, shifts: rows.map((r) => [minutesOf(r.start_time), minutesOf(r.end_time)]) });
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  if (!doc || doc.shifts.length === 0) return null;
  const now = istMinutes();
  const [first] = doc.shifts;
  if (now < first[0]) return { kind: 'before', doctorName: doc.name, at: clock12(first[0]) };
  for (let i = 0; i + 1 < doc.shifts.length; i++) {
    if (now >= doc.shifts[i][1] && now < doc.shifts[i + 1][0]) {
      return { kind: 'between', doctorName: doc.name, at: clock12(doc.shifts[i + 1][0]) };
    }
  }
  return null;
}
