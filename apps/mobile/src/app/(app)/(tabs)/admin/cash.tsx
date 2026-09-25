import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, ChipRow } from '@/components/admin/controls';
import { StateCard } from '@/components/admin/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';

// cash_report_by_staff / cash_report_by_doctor (0041_cash_desk.sql): admin-only, org resolved
// server-side, date range in the org's own timezone. Two RPCs, two groupings of one ledger.

type StaffRow = { collected_by: string; staff_name: string | null; receipt_count: number; total_inr: number };
type DoctorRow = { doctor_id: string | null; doctor_name: string | null; receipt_count: number; total_inr: number };
type Range = 0 | 6 | 29;

const RANGES: { value: Range; label: string }[] = [
  { value: 0, label: 'Today' },
  { value: 6, label: 'Last 7 days' },
  { value: 29, label: 'Last 30 days' },
];

/** IST service day `n` days before today, as YYYY-MM-DD. */
function daysBack(today: string, n: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function Rows({ rows }: { rows: { key: string; label: string; count: number; total: number }[] }) {
  if (rows.length === 0) {
    return (
      <ThemedText type="bodySm" themeColor="inkMuted">
        No cash collected in this range.
      </ThemedText>
    );
  }
  return rows.map((r) => (
    <View key={r.key} style={styles.row}>
      <View style={styles.flex}>
        <ThemedText type="body">{r.label}</ThemedText>
        <ThemedText type="caption" themeColor="inkMuted">
          {r.count} receipt{r.count === 1 ? '' : 's'}
        </ThemedText>
      </View>
      <ThemedText type="bodyLg">₹{r.total}</ThemedText>
    </View>
  ));
}

export default function AdminCash() {
  const theme = useTheme();
  const [range, setRange] = useState<Range>(0);
  const [byStaff, setByStaff] = useState<StaffRow[] | null>(null);
  const [byDoctor, setByDoctor] = useState<DoctorRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const today = todayDateString();
    const args = { p_from: daysBack(today, range), p_to: today };
    const [staffRes, doctorRes] = await Promise.all([
      supabase.rpc('cash_report_by_staff', args),
      supabase.rpc('cash_report_by_doctor', args),
    ]);
    const firstError = staffRes.error ?? doctorRes.error;
    if (firstError) {
      setError(mapSupabaseError(firstError));
      return;
    }
    setError(null);
    setByStaff((staffRes.data ?? []) as StaffRow[]);
    setByDoctor((doctorRes.data ?? []) as DoctorRow[]);
  }, [range]);
  useLiveRefresh(refetch);

  const total = (byStaff ?? []).reduce((sum, r) => sum + Number(r.total_inr), 0);
  const count = (byStaff ?? []).reduce((sum, r) => sum + Number(r.receipt_count), 0);

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ChipRow options={RANGES} value={range} onChange={setRange} />
          {error ? (
            <StateCard kind="error" message={error} />
          ) : byStaff === null ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : (
            <>
              <Card>
                <ThemedText type="caption" themeColor="inkMuted">
                  Cash collected
                </ThemedText>
                <ThemedText type="displayMd">₹{total}</ThemedText>
                <ThemedText type="bodySm" themeColor="inkSecondary">
                  {count} receipt{count === 1 ? '' : 's'}, refunds included as negatives
                </ThemedText>
              </Card>
              <Card>
                <ThemedText type="headingSm">By staff</ThemedText>
                <Rows
                  rows={byStaff.map((r) => ({
                    key: r.collected_by,
                    label: r.staff_name?.trim() || `Unnamed staff (${r.collected_by.slice(0, 8)})`,
                    count: Number(r.receipt_count),
                    total: Number(r.total_inr),
                  }))}
                />
              </Card>
              <Card>
                <ThemedText type="headingSm">By doctor</ThemedText>
                <Rows
                  rows={byDoctor.map((r) => ({
                    key: r.doctor_id ?? 'none',
                    label: r.doctor_name ?? 'No doctor chosen',
                    count: Number(r.receipt_count),
                    total: Number(r.total_inr),
                  }))}
                />
              </Card>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: Spacing.xl, alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
});
