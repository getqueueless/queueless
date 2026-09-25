import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { EmptyState, ListGroup, ListRow, Skeleton, UIText, type ChipStatus } from '@/components/ui';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Shared with receipt/[id].tsx.
export type Embed<T> = T | T[] | null;
export function one<T>(embed: Embed<T>): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** public.payment_status (0051): created | captured | failed | refunded. */
export type PaymentStatus = 'created' | 'captured' | 'failed' | 'refunded';
export type PaymentRow = { status: PaymentStatus; refunded_at: string | null; refund_reason: string | null };

/** my_payment_status (0058) returns no row when the hold never reached payment. */
export function paymentLook(p: PaymentRow | null): { chip: ChipStatus; label: string } {
  switch (p?.status) {
    case 'captured':
      return { chip: 'paid', label: 'Paid' };
    case 'refunded':
      return { chip: 'refunded', label: 'Refunded' };
    case 'failed':
      return { chip: 'pending', label: 'Failed' };
    case 'created':
      return { chip: 'pending', label: 'Pending' };
    default:
      return { chip: 'pending', label: 'Unpaid' };
  }
}

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** "26 Sep, 10:42 AM" */
export function formatWhen(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export async function fetchPayment(kind: 'token' | 'appointment', id: string) {
  return supabase
    .rpc('my_payment_status', kind === 'token' ? { p_token_id: id } : { p_appointment_id: id })
    .maybeSingle<PaymentRow>();
}

const MAX_ROWS = 30;

type TokenRow = { id: string; code: string; created_at: string; fee_inr: number; services: Embed<{ name: string }> };
type ApptRow = {
  id: string;
  created_at: string;
  fee_inr: number;
  services: Embed<{ name: string }>;
  appointment_slots: Embed<{ starts_at: string }>;
};
type Receipt = {
  id: string;
  kind: 'token' | 'appointment';
  amount: number;
  service: string;
  createdAt: string;
  detail: string;
  payment: PaymentRow | null;
};

export default function Receipts() {
  const router = useRouter();
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const [tokenRes, apptRes] = await Promise.all([
      supabase
        .from('tokens')
        .select('id, code, created_at, fee_inr, services(name)')
        .eq('patient_id', patientId)
        .not('fee_inr', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS),
      supabase
        .from('appointments')
        .select('id, created_at, fee_inr, services(name), appointment_slots(starts_at)')
        .eq('patient_id', patientId)
        .not('fee_inr', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS),
    ]);
    const queryError = tokenRes.error ?? apptRes.error;
    if (queryError) {
      setError(mapSupabaseError(queryError));
      return;
    }

    const merged = [
      ...((tokenRes.data ?? []) as unknown as TokenRow[]).map((t) => ({
        id: t.id,
        kind: 'token' as const,
        amount: t.fee_inr,
        service: one(t.services)?.name ?? 'Queue ticket',
        createdAt: t.created_at,
        detail: `Token ${t.code}`,
      })),
      ...((apptRes.data ?? []) as unknown as ApptRow[]).map((a) => {
        const startsAt = one(a.appointment_slots)?.starts_at;
        return {
          id: a.id,
          kind: 'appointment' as const,
          amount: a.fee_inr,
          service: one(a.services)?.name ?? 'Appointment',
          createdAt: a.created_at,
          detail: startsAt ? `Appointment ${formatWhen(startsAt)}` : 'Appointment',
        };
      }),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ROWS);

    const payments = await Promise.all(merged.map((r) => fetchPayment(r.kind, r.id)));
    const rpcError = payments.find((p) => p.error)?.error;
    if (rpcError) {
      setError(mapSupabaseError(rpcError));
      return;
    }
    setRows(merged.map((r, i) => ({ ...r, payment: payments[i].data ?? null })));
    setError(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: 'Payments & receipts' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <UIText color="danger">{error}</UIText>
        ) : rows === null ? (
          <ListGroup>
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </ListGroup>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={{ ios: 'creditcard', android: 'credit_card', web: 'credit_card' }}
            title="No payments yet"
            text="Paid bookings and their receipts will show up here."
          />
        ) : (
          <ListGroup>
            {rows.map((r) => (
              <ListRow
                key={`${r.kind}-${r.id}`}
                title={`${inr(r.amount)} · ${r.service}`}
                subtitle={`${formatWhen(r.createdAt)} · ${r.detail}`}
                value={paymentLook(r.payment).label}
                onPress={() =>
                  router.push({ pathname: '/(app)/receipt/[id]', params: { id: r.id, kind: r.kind } })
                }
              />
            ))}
          </ListGroup>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 20 },
});
