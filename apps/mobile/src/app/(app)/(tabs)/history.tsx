import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Row = Record<string, unknown> & { id?: string | number; status?: string };
type HistoryItem = { key: string; kind: 'token' | 'appointment'; label: string; status: string; timestamp: string | null };

// Confirmed against supabase/migrations/0001_enums.sql: token_status has no 'booked'/'checked_in'
// (those are appointment_status only), and appointment_status has no 'done' — a checked-in
// appointment becomes a token (tracked below via token_status='done' instead); 'booked' is an
// active, not-yet-resolved booking, so it's excluded from history.
const TOKEN_STATUSES = ['done', 'no_show', 'cancelled', 'skipped'];
const APPOINTMENT_STATUSES = ['cancelled', 'no_show'];

// Column names aren't fully confirmed against the live schema yet — try the columns the
// backend contract documents, and if the row shape differs, fall back gracefully instead
// of crashing the screen.
const TIMESTAMP_KEYS = ['called_at', 'completed_at', 'starts_at', 'updated_at', 'created_at'];

function pickTimestamp(row: Row): string | null {
  for (const key of TIMESTAMP_KEYS) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function pickLabel(row: Row, kind: HistoryItem['kind'], serviceNames: Record<string, string>): string {
  const serviceId = row.service_id;
  if (typeof serviceId === 'string' && serviceNames[serviceId]) return serviceNames[serviceId];
  const candidate = row.service_name ?? row.label ?? row.code;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  return kind === 'token' ? 'Queue ticket' : 'Appointment';
}

function formatDate(ts: string | null): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return ts;
  }
}

/** Fetch a table's past rows; degrade (never throw) if the status list or the table itself isn't live yet. */
async function fetchPastRows(table: 'tokens' | 'appointments', statuses: string[]): Promise<Row[]> {
  const filtered = await supabase.from(table).select('*').in('status', statuses);
  if (!filtered.error) return (filtered.data as Row[]) ?? [];

  // Status enum probably doesn't match what we guessed — retry unfiltered rather than crash.
  const unfiltered = await supabase.from(table).select('*');
  if (!unfiltered.error) return (unfiltered.data as Row[]) ?? [];

  // Table may not exist yet (migrations not landed) — treat as empty history.
  return [];
}

const STATUS_BADGE: Record<string, { bg: ThemeColor; text: ThemeColor; label: string }> = {
  done: { bg: 'successSoft', text: 'success', label: 'Done' },
  no_show: { bg: 'dangerSoft', text: 'danger', label: 'No-show' },
  cancelled: { bg: 'dangerSoft', text: 'danger', label: 'Cancelled' },
  skipped: { bg: 'surfaceSunken', text: 'inkSecondary', label: 'Skipped' },
};

function StatusBadge({ status }: { status: string }) {
  const theme = useTheme();
  const info = STATUS_BADGE[status] ?? { bg: 'surfaceSunken', text: 'inkSecondary', label: status };

  return (
    <ThemedView type={info.bg} style={[styles.badge, { borderColor: theme[info.text] }]}>
      <ThemedText type="caption" themeColor={info.text}>
        {info.label}
      </ThemedText>
    </ThemedView>
  );
}

export default function History() {
  const theme = useTheme();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tokens, appointments, servicesRes] = await Promise.all([
          fetchPastRows('tokens', TOKEN_STATUSES),
          fetchPastRows('appointments', APPOINTMENT_STATUSES),
          supabase.from('services').select('id, name'),
        ]);

        const serviceNames: Record<string, string> = {};
        for (const row of (servicesRes.data ?? []) as { id: string; name: string }[]) {
          serviceNames[row.id] = row.name;
        }

        const merged: HistoryItem[] = [
          ...tokens.map((row, i) => ({
            key: `token-${String(row.id ?? i)}`,
            kind: 'token' as const,
            label: pickLabel(row, 'token', serviceNames),
            status: row.status ?? 'unknown',
            timestamp: pickTimestamp(row),
          })),
          ...appointments.map((row, i) => ({
            key: `appointment-${String(row.id ?? i)}`,
            kind: 'appointment' as const,
            label: pickLabel(row, 'appointment', serviceNames),
            status: row.status ?? 'unknown',
            timestamp: pickTimestamp(row),
          })),
        ].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));

        if (!cancelled) setItems(merged);
      } catch {
        // Never crash the history screen over a backend that isn't fully live yet.
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="displayMd" style={styles.title}>
          History
        </ThemedText>

        {loading ? (
          <ActivityIndicator color={theme.primary} style={styles.loading} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <ThemedText type="body" themeColor="inkMuted" style={styles.empty}>
                  No past visits yet.
                </ThemedText>
              </View>
            }
            renderItem={({ item }) => (
              <ThemedView type="surface" style={[styles.row, CardShadow, { borderColor: theme.hairline }]}>
                <View style={styles.rowText}>
                  <ThemedText type="headingSm">{item.label}</ThemedText>
                  {item.timestamp ? (
                    <ThemedText type="bodySm" themeColor="inkMuted">
                      {formatDate(item.timestamp)}
                    </ThemedText>
                  ) : null}
                </View>
                <StatusBadge status={item.status} />
              </ThemedView>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  title: { marginTop: Spacing.sm, marginBottom: Spacing.md },
  loading: { marginTop: Spacing.xl, alignSelf: 'center' },
  listContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl },
  empty: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
  },
  rowText: { gap: Spacing.xxs },
  badge: {
    borderWidth: 1,
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
});
