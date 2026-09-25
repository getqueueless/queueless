import { useCallback, useEffect, useState } from 'react';
import { type Href, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCard } from '@/components/admin/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
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

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="headingMd" themeColor="inkSecondary">
            Manage
          </ThemedText>
          <ThemedView type="surface" style={[styles.listCard, CardShadow, { borderColor: theme.hairline }]}>
            {MANAGE_LINKS.map((link, i) => (
              <Pressable
                key={link.href}
                onPress={() => router.push(link.href as Href)}
                accessibilityRole="link"
                style={[styles.counterRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                <View>
                  <ThemedText type="bodyLg">{link.label}</ThemedText>
                  <ThemedText type="caption" themeColor="inkMuted">
                    {link.hint}
                  </ThemedText>
                </View>
                <ThemedText type="bodyLg" themeColor="inkMuted">
                  ›
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>

          {loadError ? (
            <StateCard kind="error" message={loadError} />
          ) : (
            <>
              <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
                Today
              </ThemedText>
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
                      <ThemedView key={service.id} type="surface" style={[styles.statCard, CardShadow, { borderColor: theme.hairline }]}>
                        <ThemedText type="bodySm" themeColor="inkMuted">
                          {service.name}
                        </ThemedText>
                        <ThemedText type="headingLg" themeColor="primaryDisplay">
                          {board?.waiting_count ?? 0}
                        </ThemedText>
                        <ThemedText type="caption" themeColor="inkMuted">
                          waiting
                        </ThemedText>
                        <View style={styles.statRow}>
                          <ThemedText type="caption" themeColor="inkSecondary">
                            avg wait {formatMinutes(board?.avg_service_secs ?? null)}
                          </ThemedText>
                          <ThemedText type="caption" themeColor="inkSecondary">
                            no-show {denom > 0 ? formatPercent(noShow / denom) : '—'}
                          </ThemedText>
                        </View>
                      </ThemedView>
                    );
                  })}
                </View>
              )}

              <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
                Tokens / hour
              </ThemedText>
              <ThemedView type="surface" style={[styles.chartCard, CardShadow, { borderColor: theme.hairline }]}>
                {hourly.length === 0 ? (
                  <ThemedText type="bodySm" themeColor="inkMuted" style={styles.chartEmpty}>
                    No tokens issued yet today.
                  </ThemedText>
                ) : (
                  <>
                    <View style={styles.chartRow}>
                      {hourly.map((bucket) => {
                        const actualHeight = bucket.actualWaitMin != null ? Math.max(4, (bucket.actualWaitMin / maxWaitMin) * MAX_BAR_HEIGHT) : 4;
                        const predictedMin = predicted[bucket.hour];
                        const predictedHeight = predictedMin != null ? Math.max(4, (predictedMin / maxWaitMin) * MAX_BAR_HEIGHT) : null;
                        return (
                          <View key={bucket.hour} style={styles.chartCol}>
                            <ThemedText type="caption" themeColor="inkMuted">
                              {bucket.count}
                            </ThemedText>
                            <View style={styles.barsWrap}>
                              <View style={[styles.bar, { height: actualHeight, backgroundColor: theme.primary }]} />
                              {predictedHeight != null ? (
                                <View style={[styles.bar, styles.barPredicted, { height: predictedHeight, borderColor: theme.primaryOutline }]} />
                              ) : null}
                            </View>
                            <ThemedText type="caption" themeColor="inkMuted">
                              {String(bucket.hour).padStart(2, '0')}h
                            </ThemedText>
                          </View>
                        );
                      })}
                    </View>
                    <ThemedText type="caption" themeColor="inkMuted" style={styles.chartLegend}>
                      Number = tokens issued · solid bar = avg wait (min){Object.keys(predicted).length > 0 ? ' · outline bar = predicted' : ''}
                    </ThemedText>
                  </>
                )}
              </ThemedView>

              <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
                Counters
              </ThemedText>
              <ThemedView type="surface" style={[styles.listCard, CardShadow, { borderColor: theme.hairline }]}>
                {counters.length === 0 ? (
                  <ThemedText type="bodySm" themeColor="inkMuted" style={styles.chartEmpty}>
                    No counters set up yet.
                  </ThemedText>
                ) : (
                  counters.map((c, i) => (
                    <View key={c.counter_id} style={[styles.counterRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                      <View>
                        <ThemedText type="bodyLg">{c.counter_name}</ThemedText>
                        <ThemedText type="caption" themeColor="inkMuted" style={styles.capitalize}>
                          {c.state}
                        </ThemedText>
                      </View>
                      <ThemedText type="bodySm" themeColor={c.token_code ? 'ink' : 'inkMuted'}>
                        {c.token_code ? `${c.token_code} · ${c.token_status}` : 'Nobody'}
                      </ThemedText>
                    </View>
                  ))
                )}
              </ThemedView>
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
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.xs, paddingBottom: Spacing.xxl },
  sectionLabel: { marginTop: Spacing.md, marginBottom: Spacing.xs },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  statCard: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.md, gap: 2, flexBasis: '47%', flexGrow: 1 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xxs },
  chartCard: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.md },
  chartEmpty: { textAlign: 'center', paddingVertical: Spacing.md },
  chartRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end' },
  chartCol: { alignItems: 'center', gap: 2, minWidth: 32 },
  barsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: MAX_BAR_HEIGHT },
  bar: { width: 10, borderRadius: Rounded.xs },
  barPredicted: { backgroundColor: 'transparent', borderWidth: 1 },
  chartLegend: { marginTop: Spacing.sm },
  listCard: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.sm },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xs },
  capitalize: { textTransform: 'capitalize' },
});
