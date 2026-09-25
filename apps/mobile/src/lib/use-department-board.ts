import { useCallback, useState } from 'react';

import { useLiveRefresh } from '@/lib/use-live-refresh';
import { estimateWaitSeconds } from '@/lib/predict';
import { useServiceUpdates } from '@/lib/service-updates';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';

// Confirmed against supabase/migrations/0003_services_counters.sql and
// 0006_boards_notifications_audit.sql: `services` has `default_service_secs`, not
// `avg_service_secs`. `board_services` is keyed by `(service_id, day)` -- must filter to today --
// and has `waiting_count`/`avg_service_secs` (nullable until a service has served anyone today)
// but NO `open_counters` column at all; that's computed client-side from `counter_services`
// joined to `counters.state`.
export type Service = { id: string; name: string; is_open: boolean; default_service_secs: number };
type BoardServiceRow = { service_id: string; waiting_count: number; avg_service_secs: number | null };
export type BoardService = { waiting_count: number; avg_service_secs: number; open_counters: number };

const EMPTY_BOARD_ROW: BoardService = { waiting_count: 0, avg_service_secs: 0, open_counters: 0 };

export function waitMinutesFor(service: Service, board: Record<string, BoardService>): number {
  const row = board[service.id] ?? { ...EMPTY_BOARD_ROW, avg_service_secs: service.default_service_secs };
  return Math.round(estimateWaitSeconds(row.waiting_count, row.avg_service_secs, row.open_counters) / 60);
}

/**
 * Every open department's live board (waiting count, wait estimate, open counters), for
 * take-token.tsx's full picker (Home's own "Departments" grid is components/home/DepartmentGrid,
 * built separately). `waiting_count` itself is still `postgres_changes` on `board_services`,
 * which never fires on this stack (empty realtime publication, docs/API_CONTRACT.md) -- so this
 * also listens to the `service:<id>` token-write broadcast (same signal DepartmentGrid/
 * LiveTokenHero use) as a nearer-instant nudge on top of the 10s poll floor.
 */
export function useDepartmentBoard() {
  const [services, setServices] = useState<Service[]>([]);
  const [board, setBoard] = useState<Record<string, BoardService>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const today = todayDateString();
    try {
      const [servicesRes, boardRes, counterRes] = await Promise.all([
        supabase.from('services').select('*').eq('is_open', true),
        supabase.from('board_services').select('service_id, waiting_count, avg_service_secs').eq('day', today),
        // No `open_counters` column exists anywhere -- derive it from which counters serving
        // each service are currently open.
        supabase.from('counter_services').select('service_id, counters(state)'),
      ]);
      if (servicesRes.error) throw servicesRes.error;
      if (boardRes.error) throw boardRes.error;
      if (counterRes.error) throw counterRes.error;

      const rows: Record<string, BoardServiceRow> = {};
      for (const row of (boardRes.data ?? []) as BoardServiceRow[]) rows[row.service_id] = row;

      // Without generated Database types, supabase-js can't tell this embed is many-to-one
      // (counter_services.counter_id -> counters.id) -- it infers `counters` as an array even
      // though PostgREST returns a single object at runtime. Handle both shapes defensively.
      const openCounters: Record<string, number> = {};
      for (const row of (counterRes.data ?? []) as unknown as {
        service_id: string;
        counters: { state: string } | { state: string }[] | null;
      }[]) {
        const counter = Array.isArray(row.counters) ? row.counters[0] : row.counters;
        if (counter?.state === 'open') openCounters[row.service_id] = (openCounters[row.service_id] ?? 0) + 1;
      }

      const nextServices = (servicesRes.data ?? []) as Service[];
      const nextBoard: Record<string, BoardService> = {};
      for (const service of nextServices) {
        nextBoard[service.id] = {
          waiting_count: rows[service.id]?.waiting_count ?? 0,
          avg_service_secs: rows[service.id]?.avg_service_secs ?? service.default_service_secs,
          open_counters: openCounters[service.id] ?? 0,
        };
      }

      setServices(nextServices);
      setBoard(nextBoard);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load services right now — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLiveRefresh(refetch, 10_000);
  useServiceUpdates(services.map((s) => s.id), refetch);

  return { services, board, loading, loadError, refetch };
}
