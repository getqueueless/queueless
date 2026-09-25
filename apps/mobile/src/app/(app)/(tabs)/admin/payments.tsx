import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, ChipRow, OutlineButton, PrimaryButton } from '@/components/admin/controls';
import { StateCard } from '@/components/admin/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api-fetch';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Reads public.payments directly -- payments_admin_read RLS (supabase/migrations/0053) already
// scopes this to the caller's own org; the explicit .eq('org_id', orgId) below matches every
// other admin screen's belt-and-suspenders pattern (see admin/index.tsx). Refunds go through
// apps/api's POST /admin/refunds (a real Razorpay refund call, never a direct DB write from a
// client), same split the web admin console uses.

type PaymentRow = {
  id: string;
  amount_inr: number;
  status: 'created' | 'captured' | 'failed' | 'refunded';
  razorpay_payment_id: string | null;
  failure_reason: string | null;
  refund_reason: string | null;
  initiated_by: string | null;
  captured_at: string | null;
  refunded_at: string | null;
  created_at: string;
  tokens: { code: string; doctors: { name: string } | null } | null;
};

type Range = 0 | 6 | 29;
const RANGES: { value: Range; label: string }[] = [
  { value: 0, label: 'Today' },
  { value: 6, label: 'Last 7 days' },
  { value: 29, label: 'Last 30 days' },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// primaryText, not primary -- raw primary (#0cb7d6) is 2.40:1 on white, below AA at this size
// (see constants/theme.ts's own comment); primaryText is the small-text-safe cyan (5.36:1).
function statusColor(status: PaymentRow['status']): 'primaryText' | 'danger' | 'inkMuted' {
  if (status === 'captured') return 'primaryText';
  if (status === 'failed') return 'danger';
  return 'inkMuted';
}

export default function AdminPayments() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId } = useRole(session?.user?.id);
  const [range, setRange] = useState<Range>(6);
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const from = daysAgo(range);
    const { data, error: err } = await supabase
      .from('payments')
      .select(
        'id, amount_inr, status, razorpay_payment_id, failure_reason, refund_reason, initiated_by, captured_at, refunded_at, created_at, tokens(code, doctors(name))',
      )
      .eq('org_id', orgId)
      .gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) {
      setError(mapSupabaseError(err));
      return;
    }
    setError(null);
    setRows(data as unknown as PaymentRow[]);
  }, [orgId, range]);
  useLiveRefresh(refetch);

  async function confirmRefund(id: string) {
    if (!refundReason.trim()) {
      setRefundError('A reason is required.');
      return;
    }
    setRefundBusy(true);
    setRefundError(null);
    const result = await apiFetch('/admin/refunds', {
      method: 'POST',
      body: JSON.stringify({ payment_id: id, reason: refundReason.trim() }),
    });
    setRefundBusy(false);
    if (!result.ok) {
      setRefundError(result.message);
      return;
    }
    setRefundingId(null);
    refetch();
  }

  const autoRefunds = (rows ?? []).filter((r) => r.status === 'refunded' && !r.initiated_by);

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ChipRow options={RANGES} value={range} onChange={setRange} />

          {error ? (
            <StateCard kind="error" message={error} />
          ) : rows === null ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : (
            <>
              <Card>
                <ThemedText type="headingSm">Online bookings</ThemedText>
                {rows.length === 0 ? (
                  <ThemedText type="bodySm" themeColor="inkMuted">
                    No online payments in this range.
                  </ThemedText>
                ) : (
                  rows.map((r) => (
                    <View key={r.id} style={styles.row}>
                      <View style={styles.rowTop}>
                        <View style={styles.flex}>
                          <ThemedText type="body">{r.tokens?.code ?? '—'}</ThemedText>
                          <ThemedText type="caption" themeColor="inkMuted">
                            {r.tokens?.doctors?.name ?? 'No doctor'}
                          </ThemedText>
                        </View>
                        <ThemedText type="bodyLg">₹{r.amount_inr}</ThemedText>
                        <ThemedText type="caption" themeColor={statusColor(r.status)} style={styles.capitalize}>
                          {r.status}
                        </ThemedText>
                      </View>

                      {r.status === 'captured' && refundingId !== r.id && (
                        <OutlineButton label="Refund" danger onPress={() => { setRefundingId(r.id); setRefundReason(''); setRefundError(null); }} />
                      )}
                      {refundingId === r.id && (
                        <View style={styles.refundForm}>
                          <TextInput
                            value={refundReason}
                            onChangeText={setRefundReason}
                            placeholder="Reason"
                            placeholderTextColor={theme.inkMuted}
                            editable={!refundBusy}
                            style={[styles.input, { borderColor: theme.hairline, color: theme.ink }]}
                          />
                          <View style={styles.refundActions}>
                            <PrimaryButton label={refundBusy ? 'Refunding…' : 'Confirm'} busy={refundBusy} onPress={() => confirmRefund(r.id)} />
                            <OutlineButton label="Cancel" disabled={refundBusy} onPress={() => setRefundingId(null)} />
                          </View>
                          {refundError && (
                            <ThemedText type="caption" themeColor="danger">
                              {refundError}
                            </ThemedText>
                          )}
                        </View>
                      )}
                      {r.status === 'refunded' && (
                        <ThemedText type="caption" themeColor="inkMuted">
                          {r.initiated_by ? 'Refunded by admin' : 'Refunded automatically (doctor on leave)'}
                        </ThemedText>
                      )}
                      {r.status === 'failed' && r.failure_reason && (
                        <ThemedText type="caption" themeColor="inkMuted">
                          {r.failure_reason}
                        </ThemedText>
                      )}
                    </View>
                  ))
                )}
              </Card>

              <Card>
                <ThemedText type="headingSm">Automatic doctor-leave refunds</ThemedText>
                <ThemedText type="caption" themeColor="inkMuted">
                  Refunded by the background job the moment a doctor&apos;s leave covered the day -- no admin action taken.
                </ThemedText>
                {autoRefunds.length === 0 ? (
                  <ThemedText type="bodySm" themeColor="inkMuted">
                    None in this range.
                  </ThemedText>
                ) : (
                  autoRefunds.map((r) => (
                    <View key={r.id} style={styles.row}>
                      <ThemedText type="body">
                        {r.tokens?.code ?? '—'} · {r.tokens?.doctors?.name ?? 'No doctor'} · ₹{r.amount_inr}
                      </ThemedText>
                      <ThemedText type="caption" themeColor="inkMuted">
                        {r.refunded_at ? new Date(r.refunded_at).toLocaleString() : '—'}
                      </ThemedText>
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
  center: { paddingVertical: Spacing.xl, alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { gap: Spacing.xxs, paddingVertical: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  capitalize: { textTransform: 'capitalize' },
  refundForm: { gap: Spacing.xs, marginTop: Spacing.xxs },
  refundActions: { flexDirection: 'row', gap: Spacing.sm },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
});
