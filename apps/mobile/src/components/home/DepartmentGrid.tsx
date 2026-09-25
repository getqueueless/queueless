import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DeptTile, EmptyState, Skeleton, UIText } from '@/components/ui';
import { hospitalOrgId } from '@/lib/hospital-org';
import { estimateWaitSeconds } from '@/lib/predict';
import { useServiceUpdates } from '@/lib/service-updates';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';

// Same reads as take-token.tsx: open services, today's board rows, and open counters per service
// (derived from counter_services; there is no open_counters column).
type Service = { id: string; name: string; default_service_secs: number };
type Board = { waiting: number; avgSecs: number; openCounters: number };

/** One tile: the local estimate at once, upgraded to apps/api's /predict when it answers. */
function LiveDeptTile({ service, board, onPress }: { service: Service; board: Board; onPress: () => void }) {
  const local = estimateWaitSeconds(board.waiting, board.avgSecs, board.openCounters);
  const [predicted, setPredicted] = useState<number | null>(null);

  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) return;
    let cancelled = false;
    const now = new Date();
    fetch(`${apiUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: service.id,
        hour: now.getHours(),
        weekday: (now.getDay() + 6) % 7, // the model's weekday 0 is Monday
        queue_len_ahead: board.waiting,
        counters_open: Math.max(board.openCounters, 1),
      }),
      signal: AbortSignal.timeout(1500),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('predict'))))
      .then((body) => {
        if (!cancelled && typeof body?.predicted_wait_minutes === 'number') {
          setPredicted(Math.round(body.predicted_wait_minutes * 60));
        }
      })
      .catch(() => {}); // the local estimate already on screen is enough
    return () => {
      cancelled = true;
    };
  }, [service.id, board.waiting, board.openCounters]);

  const seconds = board.waiting === 0 ? 0 : (predicted ?? local);
  return <DeptTile name={service.name} waitMinutes={Math.ceil(seconds / 60)} onPress={onPress} />;
}

export type DepartmentGridProps = {
  /** Defaults to opening the department screen (walk-in token or doctor booking). */
  onPressDepartment?: (serviceId: string) => void;
};

/** Open departments as warm tiles with live waits: two per row, refreshed on every queue change. */
export function DepartmentGrid({ onPressDepartment }: DepartmentGridProps) {
  const router = useRouter();
  const [services, setServices] = useState<Service[] | null>(null);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    // Only the hospital's departments, never another org's (e.g. a load test's).
    const orgId = await hospitalOrgId();
    const services = supabase.from('services').select('id, name, default_service_secs').eq('is_open', true).order('name');
    const [servicesRes, boardRes, counterRes] = await Promise.all([
      orgId ? services.eq('org_id', orgId) : services,
      supabase.from('board_services').select('service_id, waiting_count, avg_service_secs').eq('day', todayDateString()),
      supabase.from('counter_services').select('service_id, counters(state)'),
    ]);
    if (servicesRes.error || boardRes.error || counterRes.error) {
      setError(true);
      return;
    }
    const open: Record<string, number> = {};
    for (const row of (counterRes.data ?? []) as unknown as {
      service_id: string;
      counters: { state: string } | { state: string }[] | null;
    }[]) {
      const counter = Array.isArray(row.counters) ? row.counters[0] : row.counters;
      if (counter?.state === 'open') open[row.service_id] = (open[row.service_id] ?? 0) + 1;
    }
    const list = (servicesRes.data ?? []) as Service[];
    const next: Record<string, Board> = {};
    for (const s of list) next[s.id] = { waiting: 0, avgSecs: s.default_service_secs, openCounters: open[s.id] ?? 0 };
    for (const row of (boardRes.data ?? []) as { service_id: string; waiting_count: number; avg_service_secs: number | null }[]) {
      const s = next[row.service_id];
      if (s) next[row.service_id] = { ...s, waiting: row.waiting_count, avgSecs: row.avg_service_secs ?? s.avgSecs };
    }
    setServices(list);
    setBoards(next);
    setError(false);
  }, []);

  useLiveRefresh(load, 10_000);
  useServiceUpdates(services?.map((s) => s.id) ?? [], load);

  const open = (id: string) =>
    onPressDepartment
      ? onPressDepartment(id)
      : router.push({ pathname: '/(app)/department/[serviceId]', params: { serviceId: id } });

  if (services === null) {
    return error ? (
      <UIText color="inkSecondary">Couldn’t load departments. Check your connection; this retries by itself.</UIText>
    ) : (
      <View style={styles.grid} accessible accessibilityLabel="Loading departments">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.cell}>
            <Skeleton height={148} radius={20} />
          </View>
        ))}
      </View>
    );
  }

  if (services.length === 0) {
    return (
      <EmptyState
        icon={{ ios: 'building.2', android: 'local_hospital', web: 'local_hospital' }}
        title="No departments open"
        text="Nothing is taking patients right now. This updates on its own when a department opens."
      />
    );
  }

  return (
    <View style={styles.grid}>
      {services.map((s) => (
        <View key={s.id} style={styles.cell}>
          <LiveDeptTile service={s} board={boards[s.id]} onPress={() => open(s.id)} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '47%', flexGrow: 1 },
});
