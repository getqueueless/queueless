import { useCallback, useEffect, useState } from 'react';
import { type Href, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { Card, StatusChip, UIText, type ChipStatus, type IconName } from '@/components/ui';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';
import { useServiceUpdates } from '@/lib/service-updates';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Confirmed against 0003_services_counters.sql/0006_boards_notifications_audit.sql/
// 0030_rls_public_tables.sql just now: board_services (select open to anon/authenticated,
// keyed service_id+day) has waiting_count/avg_service_secs/served_count/no_show_count but no
// hourly breakdown and no open_counters column — same gap Home already works around. No
// admin_service_today/admin_hourly view exists anywhere, so the tokens/hour and no-show-rate
// numbers below are computed client-side from board_services + today's tokens, same approach as
// apps/web/src/app/admin/_lib/use-queue-stats.ts (read-only reference, not shared code).
type ServiceRow = { id: string; name: string };
type BoardServiceRow = {
  service_id: string;
  waiting_count: number;
  served_count: number;
  no_show_count: number;
  avg_service_secs: number | null;
};
type BoardCounterRow = {
  counter_id: string;
  counter_name: string;
  state: 'open' | 'paused' | 'closed';
  token_code: string | null;
  token_status: string | null;
};
type TokenRow = { service_id: string; created_at: string; called_at: string | null };
type HourBucket = { hour: number; count: number; actualWaitMin: number | null; topServiceId: string };

const MAX_BAR_HEIGHT = 96;
const CHEVRON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };
// Counter state as a dot + word, reusing StatusChip's AA-checked colour pairs.
const COUNTER_CHIP: Record<BoardCounterRow['state'], { status: ChipStatus; label: string }> = {
  open: { status: 'available', label: 'Open' },
  paused: { status: 'late', label: 'Paused' },
  closed: { status: 'leave', label: 'Closed' },
};

function formatMinutes(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return '0 min';
  return `${Math.round(seconds / 60)} min`;
}

function formatPercent(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 100)}%`;
}

// Groups today's tokens by the hour they were created (device-local hour, matching the web
// reference's own approach) — count = the "tokens/hour" bar, actualWaitMin = the hour's average
// called_at - created_at for tokens that have been called. topServiceId is a representative
// service for that hour (the one with the most tokens in it), used below to ask /predict for a
// single number per hour.
function buildHourBuckets(tokens: TokenRow[]): HourBucket[] {
  const byHour = new Map<number, { count: number; waits: number[]; serviceCounts: Map<string, number> }>();
  for (const t of tokens) {
    const hour = new Date(t.created_at).getHours();
    const bucket = byHour.get(hour) ?? { count: 0, waits: [], serviceCounts: new Map<string, number>() };
    bucket.count += 1;
    bucket.serviceCounts.set(t.service_id, (bucket.serviceCounts.get(t.service_id) ?? 0) + 1);
    if (t.called_at) {
      const waitMin = (new Date(t.called_at).getTime() - new Date(t.created_at).getTime()) / 60_000;
      if (waitMin >= 0) bucket.waits.push(waitMin);
    }
    byHour.set(hour, bucket);
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, b]) => {
      let topServiceId = '';
      let topCount = -1;
      for (const [serviceId, count] of b.serviceCounts) {
        if (count > topCount) {
          topServiceId = serviceId;
          topCount = count;
        }
      }
      return {
        hour,
        count: b.count,
        actualWaitMin: b.waits.length ? b.waits.reduce((x, y) => x + y, 0) / b.waits.length : null,
        topServiceId,
      };
    });
}

// Every admin sub-screen hangs off this list — the stack has no other way in.
const MANAGE_LINKS: { href: string; label: string; hint: string }[] = [
  { href: '/admin/doctors', label: 'Doctors', hint: 'Shifts, breaks, leave, today’s status' },
  { href: '/admin/services', label: 'Services', hint: 'Open, close, timings' },
  { href: '/admin/counters', label: 'Counters', hint: 'Names, state, services served' },
  { href: '/admin/staff', label: 'Staff', hint: 'Roles for your team' },
  { href: '/admin/cash', label: 'Cash report', hint: 'Cash collected by staff and doctor' },
  { href: '/admin/payments', label: 'Payments', hint: 'Online bookings, refunds, doctor-leave auto-refunds' },
  { href: '/admin/priority', label: 'Priority', hint: 'Head start for priority lanes' },
  { href: '/admin/ai', label: 'Ask your data', hint: 'Questions and the daily summary' },
];

export default function AdminDashboard() {
  const router = useRouter();
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [boardRows, setBoardRows] = useState<Record<string, BoardServiceRow>>({});
  const [counters, setCounters] = useState<BoardCounterRow[]>([]);
  const [hourly, setHourly] = useState<HourBucket[]>([]);
  const [predicted, setPredicted] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const today = todayDateString();
    const [servicesRes, boardRes, countersRes, tokensRes] = await Promise.all([
      supabase.from('services').select('id, name').eq('org_id', orgId).order('name'),
      supabase
        .from('board_services')
        .select('service_id, waiting_count, served_count, no_show_count, avg_service_secs')
        .eq('org_id', orgId)
        .eq('day', today),
      supabase.from('board_counters').select('counter_id, counter_name, state, token_code, token_status').eq('org_id', orgId).order('counter_name'),
      // No RLS on tokens yet either (same flagged gap as profiles) — scope by org_id/service_day
      // anyway since that's correct once RLS lands and harmless now.
      supabase.from('tokens').select('service_id, created_at, called_at').eq('org_id', orgId).eq('service_day', today),
    ]);
    const firstError = servicesRes.error ?? boardRes.error ?? countersRes.error ?? tokensRes.error;
    if (firstError) {
      setLoadError(mapSupabaseError(firstError));
      setLoading(false);
      return;
    }

    setServices((servicesRes.data ?? []) as ServiceRow[]);
    const nextBoard: Record<string, BoardServiceRow> = {};
    for (const row of (boardRes.data ?? []) as BoardServiceRow[]) nextBoard[row.service_id] = row;
    setBoardRows(nextBoard);
    setCounters((countersRes.data ?? []) as BoardCounterRow[]);
    setHourly(buildHourBuckets((tokensRes.data ?? []) as TokenRow[]));
    setLoadError(null);
    setLoading(false);
  }, [orgId]);
  useLiveRefresh(refetch);

  useServiceUpdates(services.map((sv) => sv.id), refetch);

  // Best-effort predicted-wait upgrade per hour bucket — never blocks the chart, which already
  // shows real "actual" bars from the query above. Same non-blocking fetch-in-effect shape as
  // ServiceCard's predicted wait on the Home screen.
  // ponytail: counters_open is org-wide (not per-service) and each hour's prediction is asked
  // using *today's current* queue length for that hour's busiest service, not what it actually
  // was at that hour (same naive-replay simplification apps/web's own chart documents) — good
  // enough for a demo "shape", upgrade to logged queue_len_ahead/counters_open per token if a
  // judged claim needs "this is what we predicted at the time."
  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl || hourly.length === 0) return;
    let cancelled = false;
    const openCounters = Math.max(counters.filter((c) => c.state === 'open').length, 1);
    const weekday = (new Date().getDay() + 6) % 7; // JS: 0=Sun -> API: 0=Mon

    Promise.all(
      hourly.map(async (bucket) => {
        const waitingCount = boardRows[bucket.topServiceId]?.waiting_count ?? 0;
        try {
          const res = await fetch(`${apiUrl}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id: bucket.topServiceId,
              hour: bucket.hour,
              weekday,
              queue_len_ahead: waitingCount,
              counters_open: openCounters,
            }),
            signal: AbortSignal.timeout(1500),
          });
          if (!res.ok) return null;
          const body = await res.json();
          return typeof body?.predicted_wait_minutes === 'number' ? { hour: bucket.hour, minutes: body.predicted_wait_minutes } : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<number, number> = {};
      for (const r of results) if (r) next[r.hour] = r.minutes;
      setPredicted(next);
    });

    return () => {
      cancelled = true;
    };
  }, [hourly, boardRows, counters]);

  if (roleLoading || (orgId && loading)) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  if (!orgId) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <StateCard kind="error" message="No organization assigned to this account." />
        </View>
      </ThemedView>
    );
  }

  const maxWaitMin = Math.max(1, ...hourly.map((h) => h.actualWaitMin ?? 0), ...Object.values(predicted));
  const hasPredicted = Object.keys(predicted).length > 0;

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <UIText variant="title3" accessibilityRole="header" style={styles.sectionLabel}>
            Manage
          </UIText>
          <Card style={styles.listCard}>
            {MANAGE_LINKS.map((link, i) => (
              <Pressable
                key={link.href}
                onPress={() => router.push(link.href as Href)}
                accessibilityRole="link"
                accessibilityLabel={link.label}
                accessibilityHint={link.hint}
                style={({ pressed }) => [
                  styles.linkRow,
                  i > 0 && { borderTopWidth: 1, borderColor: theme.hairline },
                  pressed && { backgroundColor: theme.surfaceSunken },
                ]}>
                <View style={styles.rowText}>
                  <UIText variant="bodyStrong">{link.label}</UIText>
                  <UIText variant="secondary" numberOfLines={1}>
                    {link.hint}
                  </UIText>
                </View>
                <SymbolView name={CHEVRON} size={20} tintColor={theme.inkSecondary} />
              </Pressable>
            ))}
          </Card>

          {loadError ? (
            <StateCard kind="error" message={loadError} />
          ) : (
            <>
              <UIText variant="title3" accessibilityRole="header" style={styles.sectionLabel}>
                Today
              </UIText>
              {services.length === 0 ? (
                <StateCard kind="empty" message="No services set up yet." />
              ) : (
                <View style={styles.statGrid}>
                  {services.map((service) => {
                    const board = boardRows[service.id];
                    const served = board?.served_count ?? 0;
                    const noShow = board?.no_show_count ?? 0;
                    const denom = served + noShow;
                    return (
                      <Card key={service.id} style={styles.statCard}>
                        <UIText variant="secondaryStrong" color="inkSecondary" numberOfLines={2}>
                          {service.name}
                        </UIText>
                        <View>
                          <UIText variant="title2" color="primaryDisplay">
                            {board?.waiting_count ?? 0}
                          </UIText>
                          <UIText variant="secondary">waiting</UIText>
                        </View>
                        <View style={[styles.statFoot, { borderColor: theme.hairline }]}>
                          <View style={styles.statLine}>
                            <UIText variant="secondary">Avg wait</UIText>
                            <UIText variant="secondaryStrong">{formatMinutes(board?.avg_service_secs ?? null)}</UIText>
                          </View>
                          <View style={styles.statLine}>
                            <UIText variant="secondary">No-show</UIText>
                            <UIText variant="secondaryStrong">{denom > 0 ? formatPercent(noShow / denom) : '—'}</UIText>
                          </View>
                        </View>
                      </Card>
                    );
                  })}
                </View>
              )}

              <UIText variant="title3" accessibilityRole="header" style={styles.sectionLabel}>
                Tokens / hour
              </UIText>
              <Card>
                {hourly.length === 0 ? (
                  <UIText variant="secondary" style={styles.chartEmpty}>
                    No tokens issued yet today.
                  </UIText>
                ) : (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartRow}>
                      {hourly.map((bucket) => {
                        const actualHeight = bucket.actualWaitMin != null ? Math.max(4, (bucket.actualWaitMin / maxWaitMin) * MAX_BAR_HEIGHT) : 4;
                        const predictedMin = predicted[bucket.hour];
                        const predictedHeight = predictedMin != null ? Math.max(4, (predictedMin / maxWaitMin) * MAX_BAR_HEIGHT) : null;
                        return (
                          <View
                            key={bucket.hour}
                            style={styles.chartCol}
                            accessible
                            accessibilityLabel={`${String(bucket.hour).padStart(2, '0')}:00, ${bucket.count} tokens, average wait ${
                              bucket.actualWaitMin != null ? `${Math.round(bucket.actualWaitMin)} min` : 'not yet known'
                            }${predictedMin != null ? `, predicted ${Math.round(predictedMin)} min` : ''}`}>
                            <UIText variant="secondaryStrong">{bucket.count}</UIText>
                            <View style={styles.barsWrap}>
                              <View style={[styles.bar, { height: actualHeight, backgroundColor: theme.primary }]} />
                              {predictedHeight != null ? (
                                <View style={[styles.bar, styles.barPredicted, { height: predictedHeight, borderColor: theme.primaryText }]} />
                              ) : null}
                            </View>
                            <UIText variant="secondary">{String(bucket.hour).padStart(2, '0')}h</UIText>
                          </View>
                        );
                      })}
                    </ScrollView>
                    <View style={[styles.legend, { borderColor: theme.hairline }]}>
                      <UIText variant="secondary">Top number = tokens issued</UIText>
                      <View style={styles.legendItem}>
                        <View style={[styles.swatch, { backgroundColor: theme.primary }]} />
                        <UIText variant="secondary">Avg wait (min)</UIText>
                      </View>
                      {hasPredicted ? (
                        <View style={styles.legendItem}>
                          <View style={[styles.swatch, styles.barPredicted, { borderColor: theme.primaryText }]} />
                          <UIText variant="secondary">Predicted wait</UIText>
                        </View>
                      ) : null}
                    </View>
                  </>
                )}
              </Card>

              <UIText variant="title3" accessibilityRole="header" style={styles.sectionLabel}>
                Counters
              </UIText>
              <Card style={styles.listCard}>
                {counters.length === 0 ? (
                  <UIText variant="secondary" style={styles.chartEmpty}>
                    No counters set up yet.
                  </UIText>
                ) : (
                  counters.map((c, i) => (
                    <View key={c.counter_id} style={[styles.linkRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                      <View style={styles.rowText}>
                        <UIText variant="bodyStrong">{c.counter_name}</UIText>
                        <UIText variant="secondary" color={c.token_code ? 'ink' : 'inkSecondary'}>
                          {c.token_code ? `${c.token_code} · ${c.token_status}` : 'Nobody'}
                        </UIText>
                      </View>
                      <StatusChip status={COUNTER_CHIP[c.state].status} label={COUNTER_CHIP[c.state].label} />
                    </View>
                  ))
                )}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.md },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  sectionLabel: { marginTop: Spacing.sm },
  listCard: { padding: 0, gap: 0 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 56,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: { flexBasis: '47%', flexGrow: 1, gap: Spacing.xs },
  statFoot: { borderTopWidth: 1, paddingTop: Spacing.xs, gap: 2 },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.xs },
  chartEmpty: { textAlign: 'center', paddingVertical: Spacing.md },
  chartRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end' },
  chartCol: { alignItems: 'center', gap: Spacing.xxs, minWidth: 40 },
  barsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: MAX_BAR_HEIGHT },
  bar: { width: 12, borderRadius: Rounded.xs },
  barPredicted: { backgroundColor: 'transparent', borderWidth: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md, rowGap: Spacing.xs, borderTopWidth: 1, paddingTop: Spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  swatch: { width: 14, height: 14, borderRadius: Rounded.xs },
});
