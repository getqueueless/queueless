import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Button, Card, Skeleton, StatusChip, UIText } from '@/components/ui';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import { fetchPayment, formatWhen, inr, one, paymentLook, type Embed, type PaymentRow } from '../receipts';

const ACTIVE_STATUSES = ['waiting', 'called', 'serving', 'pending_payment', 'booked'];

type Booking = {
  id: string;
  status: string;
  fee_inr: number | null;
  created_at: string;
  service_id: string;
  code?: string;
  services: Embed<{ name: string }>;
  doctors: Embed<{ name: string }>;
  appointment_slots?: Embed<{ starts_at: string }>;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <UIText variant="secondary">{label}</UIText>
      <UIText style={styles.value}>{value}</UIText>
    </View>
  );
}

export default function Receipt() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; kind: string }>();
  const id = params.id;
  const kind = params.kind === 'appointment' ? 'appointment' : 'token';
  const [booking, setBooking] = useState<Booking | null>(null);
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const query =
      kind === 'token'
        ? supabase.from('tokens').select('id, code, status, fee_inr, created_at, service_id, services(name), doctors(name)')
        : supabase
            .from('appointments')
            .select('id, status, fee_inr, created_at, service_id, services(name), doctors(name), appointment_slots(starts_at)');
    Promise.all([query.eq('id', id).maybeSingle(), fetchPayment(kind, id)]).then(([b, p]) => {
      if (!live) return;
      const err = b.error ?? p.error;
      if (err || !b.data) {
        setError(err ? mapSupabaseError(err) : 'Receipt not found.');
        return;
      }
      setBooking(b.data as unknown as Booking);
      setPayment(p.data ?? null);
    });
    return () => {
      live = false;
    };
  }, [id, kind]);

  const look = paymentLook(payment);
  const doctor = booking ? one(booking.doctors)?.name : null;
  const startsAt = booking ? one(booking.appointment_slots ?? null)?.starts_at : null;

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: 'Receipt' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <UIText color="danger">{error}</UIText>
        ) : !booking ? (
          <Skeleton height={320} radius={20} />
        ) : (
          <>
            <Card>
              <UIText variant="title1">{booking.fee_inr != null ? inr(booking.fee_inr) : '—'}</UIText>
              <StatusChip status={look.chip} label={look.label} />
              <Row label="Service" value={one(booking.services)?.name ?? '—'} />
              {doctor ? <Row label="Doctor" value={doctor} /> : null}
              {kind === 'token' ? (
                <Row label="Token code" value={booking.code ?? '—'} />
              ) : (
                <Row label="Appointment time" value={startsAt ? formatWhen(startsAt) : 'To be confirmed'} />
              )}
              <Row label="Booked on" value={formatWhen(booking.created_at)} />
              <Row label="Payment status" value={look.label} />
              {payment?.status === 'refunded' ? (
                <>
                  <Row label="Refunded on" value={payment.refunded_at ? formatWhen(payment.refunded_at) : '—'} />
                  {payment.refund_reason ? <Row label="Refund reason" value={payment.refund_reason} /> : null}
                </>
              ) : null}
              <Row label="Receipt ID" value={booking.id} />
            </Card>
            {ACTIVE_STATUSES.includes(booking.status) ? (
              <Button
                label="View live status"
                onPress={() =>
                  kind === 'token'
                    ? router.push({ pathname: '/(app)/token/[id]', params: { id: booking.id, serviceId: booking.service_id } })
                    : router.push('/(app)/(tabs)/my-tokens')
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 20 },
  row: { gap: 2 },
  value: { fontVariant: ['tabular-nums'] },
});
