import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, ChipRow, OutlineButton, PrimaryButton } from '@/components/admin/controls';
import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { EmptyState, StatusChip, UIText, type ChipStatus } from '@/components/ui';
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

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

function whenOf(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

// StatusChip has no "failed" look; the neutral grey chip reads closest, the reason shows in red below.
const CHIP: Record<PaymentRow['status'], { status: ChipStatus; label?: string }> = {
  captured: { status: 'paid' },
  refunded: { status: 'refunded' },
  created: { status: 'pending' },
  failed: { status: 'leave', label: 'Failed' },
};

const EMPTY_ICON = { ios: 'creditcard', android: 'payments', web: 'payments' } as const;

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
                <UIText variant="title3" accessibilityRole="header">
                  Online bookings
                </UIText>
                {rows.length === 0 ? (
                  <EmptyState icon={EMPTY_ICON} title="No online payments" text="Nothing was paid online in this range." />
                ) : (
                  rows.map((r) => (
                    <View key={r.id} style={[styles.row, { borderTopColor: theme.hairline }]}>
                      <View style={styles.rowTop}>
                        <View style={styles.flex}>
                          <UIText variant="title3">{inr(r.amount_inr)}</UIText>
                          <UIText variant="secondary">
                            {r.tokens?.code ?? '—'} · {r.tokens?.doctors?.name ?? 'No doctor'}
                          </UIText>
                          <UIText variant="secondary">{whenOf(r.captured_at ?? r.created_at)}</UIText>
                        </View>
                        <StatusChip status={CHIP[r.status].status} label={CHIP[r.status].label} />
                      </View>

                      {r.status === 'captured' && refundingId !== r.id && (
                        <OutlineButton label="Refund" danger onPress={() => { setRefundingId(r.id); setRefundReason(''); setRefundError(null); }} />
                      )}
                      {refundingId === r.id && (
                        <View style={styles.refundForm}>
                          <LabeledInput
                            label="Refund reason"
                            value={refundReason}
                            onChangeText={setRefundReason}
                            placeholder="Reason"
                            editable={!refundBusy}
                          />
                          <View style={styles.refundActions}>
                            <PrimaryButton label={refundBusy ? 'Refunding…' : 'Confirm'} busy={refundBusy} onPress={() => confirmRefund(r.id)} />
                            <OutlineButton label="Cancel" disabled={refundBusy} onPress={() => setRefundingId(null)} />
                          </View>
                          {refundError && (
                            <UIText variant="secondary" color="danger" accessibilityRole="alert">
                              {refundError}
                            </UIText>
                          )}
                        </View>
                      )}
                      {r.status === 'refunded' && (
                        <UIText variant="secondary">
                          {r.initiated_by ? 'Refunded by admin' : 'Refunded automatically (doctor on leave)'}
                        </UIText>
                      )}
                      {r.status === 'failed' && r.failure_reason && (
                        <UIText variant="secondary" color="danger">
                          {r.failure_reason}
                        </UIText>
                      )}
                    </View>
                  ))
                )}
              </Card>

              <Card>
                <UIText variant="title3" accessibilityRole="header">
                  Automatic doctor-leave refunds
                </UIText>
                <UIText variant="secondary">
                  Refunded by the background job the moment a doctor&apos;s leave covered the day -- no admin action taken.
                </UIText>
                {autoRefunds.length === 0 ? (
                  <UIText variant="secondary">None in this range.</UIText>
                ) : (
                  autoRefunds.map((r) => (
                    <View key={r.id} style={[styles.logRow, { borderTopColor: theme.hairline }]}>
                      <View style={styles.flex}>
                        <UIText variant="bodyStrong">
                          {r.tokens?.code ?? '—'} · {r.tokens?.doctors?.name ?? 'No doctor'}
                        </UIText>
                        <UIText variant="secondary">{r.refunded_at ? whenOf(r.refunded_at) : '—'}</UIText>
                      </View>
                      <UIText variant="bodyStrong">{inr(r.amount_inr)}</UIText>
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
  safeArea: { flex: 1, paddingHorizontal: Spacing.md },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { gap: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 56, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
  refundForm: { gap: Spacing.sm },
  refundActions: { flexDirection: 'row', gap: Spacing.sm },
});
