import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChipRow } from '@/components/admin/controls';
import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { Card, UIText } from '@/components/ui';
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

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** IST service day `n` days before today, as YYYY-MM-DD. */
function daysBack(today: string, n: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function Rows({ title, rows }: { title: string; rows: { key: string; label: string; count: number; total: number }[] }) {
  const theme = useTheme();
  return (
    <Card>
      <UIText variant="title3" accessibilityRole="header">
        {title}
      </UIText>
      {rows.length === 0 ? (
        <UIText variant="secondary">No cash collected in this range.</UIText>
      ) : (
        rows.map((r) => (
          <View key={r.key} style={[styles.row, { borderTopColor: theme.hairline }]}>
            <View style={styles.flex}>
              <UIText variant="bodyStrong">{r.label}</UIText>
              <UIText variant="secondary">
                {r.count} receipt{r.count === 1 ? '' : 's'}
              </UIText>
            </View>
            <UIText variant="bodyStrong" color={r.total < 0 ? 'danger' : 'ink'}>
              {inr(r.total)}
            </UIText>
          </View>
        ))
      )}
    </Card>
  );
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
              <Card style={{ backgroundColor: theme.primarySoft, borderColor: theme.primarySoft }}>
                <UIText variant="secondaryStrong" color="primaryText">
                  Cash collected · {RANGES.find((r) => r.value === range)?.label}
                </UIText>
                <UIText variant="title1">{inr(total)}</UIText>
                <UIText variant="secondary" color="ink">
                  {count} receipt{count === 1 ? '' : 's'}, refunds included as negatives
                </UIText>
              </Card>
              <Rows
                title="By staff"
                rows={byStaff.map((r) => ({
                  key: r.collected_by,
                  label: r.staff_name?.trim() || `Unnamed staff (${r.collected_by.slice(0, 8)})`,
                  count: Number(r.receipt_count),
                  total: Number(r.total_inr),
                }))}
              />
              <Rows
                title="By doctor"
                rows={byDoctor.map((r) => ({
                  key: r.doctor_id ?? 'none',
                  label: r.doctor_name ?? 'No doctor chosen',
                  count: Number(r.receipt_count),
                  total: Number(r.total_inr),
                }))}
              />
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
  safeArea: { flex: 1, paddingHorizontal: Spacing.md },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 56, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
});
