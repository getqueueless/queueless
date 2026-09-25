// Billing/review screen before Razorpay: the web equivalent of apps/web/src/app/pay/[holdId] --
// same hold (a walk-in token OR a booked appointment, tried in that order, ids don't overlap
// between the two tables), same handoff (openPaymentHandoff opens /pay/<holdId> in an in-app
// browser, returns via queueless://paid/<holdId>). This screen never talks to Razorpay directly;
// the web page still owns the checkout.js integration.

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, CheckoutSummary, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { openPaymentHandoff } from '@/lib/paid-booking';
import { supabase } from '@/lib/supabase';

type Profile = { full_name: string | null; phone: string | null };

type Hold = {
  id: string;
  kind: 'token' | 'appointment';
  status: string;
  feeInr: number;
  holdExpiresAt: string | null;
  doctorId: string | null;
  code: string | null;
  startsAt: string | null;
};

type Doctor = { name: string; specialty: string };
type Phase = 'loading' | 'idle' | 'paying' | 'paid' | 'expired' | 'cancelled' | 'not_found';

const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

// Explicit locale AND explicit timeZone -- same fix as the web checkout page's own formatWhen,
// avoids a divergent-render trap between the device's locale and the dev/prod build's default.
function formatWhen(startsAt: string) {
  const d = new Date(startsAt);
  const date = d.toLocaleDateString('en-US', { timeZone: DISPLAY_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: DISPLAY_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

async function fetchHold(id: string): Promise<Hold | null> {
  const { data: token } = await supabase
    .from('tokens')
    .select('id, code, status, fee_inr, hold_expires_at, doctor_id')
    .eq('id', id)
    .maybeSingle();
  if (token) {
    return {
      id: token.id, kind: 'token', status: token.status, feeInr: token.fee_inr ?? 0,
      holdExpiresAt: token.hold_expires_at, doctorId: token.doctor_id, code: token.code, startsAt: null,
    };
  }

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, status, fee_inr, hold_expires_at, doctor_id, appointment_slots(starts_at)')
    .eq('id', id)
    .maybeSingle();
  if (!appt) return null;
  const slotRow = appt.appointment_slots as { starts_at: string } | { starts_at: string }[] | null;
  const slot = Array.isArray(slotRow) ? slotRow[0] : slotRow;
  return {
    id: appt.id, kind: 'appointment', status: appt.status, feeInr: appt.fee_inr ?? 0,
    holdExpiresAt: appt.hold_expires_at, doctorId: appt.doctor_id, code: null, startsAt: slot?.starts_at ?? null,
  };
}

function phaseFromStatus(status: string): Phase {
  if (status === 'pending_payment') return 'idle';
  if (status === 'waiting' || status === 'booked') return 'paid';
  return 'expired';
}

export default function CheckoutScreen() {
  const { holdId } = useLocalSearchParams<{ holdId: string }>();
  const router = useRouter();
  const theme = useTheme();

  const [hold, setHold] = useState<Hold | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    if (!holdId) return;
    const h = await fetchHold(holdId);
    if (!h) {
      setPhase('not_found');
      return;
    }
    setHold(h);
    setPhase(phaseFromStatus(h.status));
    if (h.doctorId) {
      const { data } = await supabase.from('doctors').select('name, specialty').eq('id', h.doctorId).maybeSingle();
      setDoctor(data as Doctor | null);
    }
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: profileRow } = await supabase.from('profiles').select('full_name, phone').eq('id', auth.user.id).maybeSingle();
      setProfile(profileRow as Profile | null);
    }
  }, [holdId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleProceed() {
    if (!holdId) return;
    setNotice(null);
    setPhase('paying');
    const result = await openPaymentHandoff(holdId);
    const fresh = await fetchHold(holdId);
    if (fresh) setHold(fresh);
    const nextPhase = fresh ? phaseFromStatus(fresh.status) : 'idle';
    if (nextPhase === 'paid' || result.paid) {
      setPhase('paid');
    } else {
      setPhase(nextPhase === 'expired' ? 'expired' : 'idle');
      if (nextPhase !== 'expired') {
        setNotice("Payment wasn't completed. Your slot is still held — try again below.");
      }
    }
  }

  async function handleCancel() {
    if (!hold) return;
    setCancelBusy(true);
    setNotice(null);
    const { error } = await supabase.rpc('cancel_hold', { p_id: hold.id });
    setCancelBusy(false);
    if (error) {
      setNotice('Could not cancel. Please try again.');
      return;
    }
    setPhase('cancelled');
  }

  if (phase === 'loading') {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.canvasSoft }]}>
        <Stack.Screen options={{ title: 'Checkout' }} />
      </SafeAreaView>
    );
  }

  if (phase === 'not_found' || phase === 'expired' || phase === 'cancelled') {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.canvasSoft }]}>
        <Stack.Screen options={{ title: 'Checkout' }} />
        <View style={styles.centered}>
          <UIText variant="bodyStrong" style={styles.centerText}>
            {phase === 'cancelled'
              ? 'This booking was cancelled.'
              : phase === 'expired'
                ? 'This hold has expired and the spot was released.'
                : "This booking link isn't valid."}
          </UIText>
          <Button label="Back home" onPress={() => router.replace('/(app)/(tabs)')} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'paid' && hold) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.canvasSoft }]}>
        <Stack.Screen options={{ title: 'Booked' }} />
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={[styles.checkCircle, { backgroundColor: theme.success }]}>
            <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={32} tintColor={theme.surface} />
          </View>
          <UIText variant="title3" style={styles.centerText}>
            Payment confirmed. Your spot is booked.
          </UIText>
          <View style={[styles.receipt, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
            {hold.code && (
              <View style={styles.receiptRow}>
                <UIText color="inkSecondary">Code</UIText>
                <UIText variant="bodyStrong">{hold.code}</UIText>
              </View>
            )}
            {hold.startsAt && (
              <View style={styles.receiptRow}>
                <UIText color="inkSecondary">When</UIText>
                <UIText variant="bodyStrong">{formatWhen(hold.startsAt)}</UIText>
              </View>
            )}
            <View style={styles.receiptRow}>
              <UIText color="inkSecondary">Amount paid</UIText>
              <UIText variant="bodyStrong">₹{hold.feeInr}</UIText>
            </View>
          </View>
          <Button
            label="View live status"
            block
            onPress={() =>
              hold.kind === 'token'
                ? router.replace({ pathname: '/(app)/token/[id]', params: { id: hold.id } })
                : router.replace('/(app)/(tabs)/my-tokens')
            }
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!hold) return null;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.canvasSoft }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <CheckoutSummary
        doctor={{
          name: doctor?.name ?? 'Booking',
          department: [doctor?.specialty, hold.startsAt ? formatWhen(hold.startsAt) : 'Walk-in token']
            .filter(Boolean)
            .join(' · '),
        }}
        lines={[
          { label: 'Consultation fee', amountInr: hold.feeInr },
          { label: 'Platform fee', amountInr: 0 },
        ]}
        holdExpiresAt={hold.holdExpiresAt}
        onProceed={handleProceed}
        loading={phase === 'paying'}>
        <View style={[styles.patientRow, { borderColor: theme.hairline }]}>
          <View style={styles.flex}>
            <UIText variant="bodyStrong">{profile?.full_name ?? 'Your details'}</UIText>
            {profile?.phone && <UIText color="inkSecondary">{profile.phone}</UIText>}
          </View>
          <UIText color="primaryText" onPress={() => router.push('/(app)/name-entry')}>
            Edit
          </UIText>
        </View>

        <UIText color="inkSecondary" variant="secondary">
          Refunds are automatic if the doctor goes on leave. Otherwise, cancellations are reviewed
          by the clinic admin.
        </UIText>

        {notice && <UIText color="warning">{notice}</UIText>}

        {notice && (
          <Button label="Cancel booking" variant="secondary" loading={cancelBusy} onPress={handleCancel} />
        )}
      </CheckoutSummary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  centerText: { textAlign: 'center' },
  successContent: { padding: 24, gap: 16, alignItems: 'center' },
  checkCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  receipt: { width: '100%', borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  patientRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, gap: 12,
  },
});
