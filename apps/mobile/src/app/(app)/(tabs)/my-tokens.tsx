import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QueueTracker, type TrackerStatus } from '@/components/motion/QueueTracker';
import { useEtaAtJoin, useNowServing } from '@/components/motion/use-queue-extras';
import { BottomSheet, Button, Card, Chip, EmptyState, SectionHeader, Skeleton, StatusChip, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { formatFee } from '@/lib/doctors';
import { isCheckInWindow } from '@/lib/appointmentWindow';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { mapSupabaseError } from '@/lib/errors';
import { showToast } from '@/lib/toast-store';

// doctor_status_today (0038): a stale/missing row reads back as 'available', same convention
// lib/doctors.ts's fetchDoctor uses -- kept as its own tiny query here rather than pulling in
// fetchDoctor's heavier shifts+leaves joins, which this card doesn't need.
type LiveDoctorStatus = { status: 'available' | 'running_late' | 'on_break' | 'off'; late_minutes: number | null };

function doctorStatusLine(doctorName: string, live: LiveDoctorStatus | null, startsAt: string | null): string | null {
  if (!live) return null;
  if (live.status === 'off') return `${doctorName} is on leave today.`;
  if (live.status === 'on_break') return `${doctorName} is on a break right now.`;
  if (live.status === 'running_late' && live.late_minutes) {
    const eta = startsAt ? new Date(new Date(startsAt).getTime() + live.late_minutes * 60_000) : null;
    const etaLabel = eta ? `, expect ~${eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    return `${doctorName} is running ${live.late_minutes} min late${etaLabel}.`;
  }
  return `${doctorName} is available.`;
}

function formatCountdown(startsAt: string): string | null {
  const diffMinutes = Math.round((new Date(startsAt).getTime() - Date.now()) / 60_000);
  if (diffMinutes <= 0) return null;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return hours > 0 ? `in ${hours} h ${minutes} m` : `in ${minutes} m`;
}

function formatOpensAt(startsAt: string): string {
  const opensAt = new Date(new Date(startsAt).getTime() - 30 * 60_000);
  return opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ACTIVE_TOKEN_STATUSES = ['pending_payment', 'waiting', 'called', 'serving'];
const PAST_TOKEN_STATUSES = ['done', 'no_show', 'cancelled', 'skipped'];
const PAST_APPOINTMENT_STATUSES = ['cancelled', 'no_show'];

type Embed<T> = T | T[] | null;
function one<T>(embed: Embed<T>): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

// -------------------- Active --------------------

type ActiveTokenRow = { id: string; service_id: string };

type QueueStatus = {
  code: string;
  status: TrackerStatus;
  service_name: string;
  ahead: number | null;
  eta_seconds: number | null;
  counter_name: string | null;
};

function ActiveTokenCard({
  tokenId,
  onPress,
  onCancel,
}: {
  tokenId: string;
  onPress: () => void;
  onCancel: (status: 'waiting' | 'pending_payment') => void;
}) {
  const [status, setStatus] = useState<QueueStatus | null>(null);

  const refetch = useCallback(async () => {
    const { data } = await supabase.rpc('my_queue_status', { p_token: tokenId }).single();
    if (data) setStatus(data as QueueStatus);
  }, [tokenId]);

  useLiveRefresh(refetch, 10_000);

  const etaMinutes = status?.eta_seconds == null ? null : Math.ceil(status.eta_seconds / 60);
  const etaAtJoin = useEtaAtJoin(tokenId, etaMinutes);
  const nowServing = useNowServing(tokenId, status);

  if (!status) return <Skeleton height={160} radius={20} />;

  return (
    <Card accessibilityLabel={`Ticket ${status.code}, ${status.service_name}`}>
      <Pressable onPress={onPress}>
        <View style={styles.activeHeader}>
          <UIText variant="title3">{status.code}</UIText>
          <UIText variant="secondary">{status.service_name}</UIText>
        </View>
        <QueueTracker
          status={status.status}
          ahead={status.ahead}
          etaMinutes={etaMinutes}
          etaAtJoin={etaAtJoin}
          counterCode={status.counter_name}
          nowServingNumber={nowServing}
          serviceName={status.service_name}
        />
      </Pressable>
      {/* cancel_token (0011) only matches status='waiting'; a pending_payment hold goes through
          cancel_hold (0070) instead -- two different RPCs, same button slot. */}
      {status.status === 'waiting' ? (
        <Button label="Cancel ticket" variant="ghost" size="md" onPress={() => onCancel('waiting')} style={styles.cancelButton} />
      ) : status.status === 'pending_payment' ? (
        <Button label="Cancel hold" variant="ghost" size="md" onPress={() => onCancel('pending_payment')} style={styles.cancelButton} />
      ) : null}
    </Card>
  );
}

const ACTIVE_APPOINTMENT_STATUSES = ['pending_payment', 'booked'];

type ActiveAppointmentRow = {
  id: string;
  service_id: string;
  status: string;
  fee_inr: number | null;
  appointment_slots: Embed<{ starts_at: string }>;
  doctors: Embed<{ id: string; name: string }>;
  services: Embed<{ name: string }>;
};

function formatSlot(startsAt: string) {
  const d = new Date(startsAt);
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function ActiveAppointmentCard({
  appt,
  doctorId,
  doctorName,
  onOpenDetails,
  onCheckIn,
  onPayNow,
  onCancel,
}: {
  appt: ActiveAppointmentRow;
  doctorId: string | null;
  doctorName: string | null;
  onOpenDetails: (() => void) | null;
  onCheckIn: () => void;
  onPayNow: () => void;
  onCancel: (status: 'booked' | 'pending_payment') => void;
}) {
  const startsAt = one(appt.appointment_slots)?.starts_at ?? null;
  const serviceName = one(appt.services)?.name ?? 'Appointment';
  const pendingPayment = appt.status === 'pending_payment';
  const canCheckIn = !pendingPayment && startsAt ? isCheckInWindow(new Date(startsAt), new Date()) : false;
  const countdown = startsAt ? formatCountdown(startsAt) : null;

  const [liveStatus, setLiveStatus] = useState<LiveDoctorStatus | null>(null);
  const refetchDoctorStatus = useCallback(async () => {
    if (!doctorId) return;
    const { data } = await supabase.from('doctor_status_today').select('status, late_minutes').eq('doctor_id', doctorId).maybeSingle();
    setLiveStatus((data as LiveDoctorStatus | null) ?? { status: 'available', late_minutes: null });
  }, [doctorId]);
  useLiveRefresh(refetchDoctorStatus, 30_000);

  const chipLabel = pendingPayment ? 'Payment pending' : appt.fee_inr ? 'Paid' : 'Booked';
  const chipStatus = pendingPayment ? 'pending' : 'paid';
  const statusLine = doctorName ? doctorStatusLine(doctorName, liveStatus, startsAt) : null;

  const info = (
    <>
      <View style={styles.apptHeaderRow}>
        <UIText variant="bodyStrong">{serviceName}</UIText>
        <StatusChip status={chipStatus} label={countdown ? `${chipLabel} · ${countdown}` : chipLabel} />
      </View>
      {doctorName ? <UIText variant="secondary">{doctorName}</UIText> : null}
      <UIText variant="body">{startsAt ? formatSlot(startsAt) : 'Time to be confirmed'}</UIText>
      {statusLine ? (
        <UIText variant="secondaryStrong" color={liveStatus?.status === 'running_late' ? 'warning' : 'inkSecondary'}>
          {statusLine}
        </UIText>
      ) : null}
      <UIText variant="secondary" style={styles.apptExplainer}>
        You&apos;ll join the live queue when you check in at the hospital. Check-in opens 30 min before your slot.
      </UIText>
    </>
  );

  return (
    <Card style={styles.apptCard}>
      {onOpenDetails ? <Pressable onPress={onOpenDetails}>{info}</Pressable> : info}
      {pendingPayment ? (
        <Button label="Pay now" size="md" block onPress={onPayNow} />
      ) : canCheckIn ? (
        <Button label="Check in" size="lg" block onPress={onCheckIn} />
      ) : startsAt ? (
        <Button label={`Opens at ${formatOpensAt(startsAt)}`} size="lg" block disabled onPress={() => {}} />
      ) : null}
      {/* cancel_appointment (0013) only matches status='booked'; a pending_payment hold goes
          through cancel_hold (0070) instead -- two different RPCs, same button slot. */}
      <Button
        label={pendingPayment ? 'Cancel hold' : 'Cancel booking'}
        variant="ghost"
        size="md"
        onPress={() => onCancel(appt.status === 'pending_payment' ? 'pending_payment' : 'booked')}
        style={styles.cancelButton}
      />
    </Card>
  );
}

// HOLD_OUTCOME is the exact copy from apps/web/src/app/my/_components/CancelButton.tsx -- said
// before the patient confirms, so it has to match what the backend actually does. The paid-
// appointment message below follows 0059's real policy (2+ hours out: automatic refund via
// apps/api's refund_job; under 2 hours: not automatic, though the hospital can still approve one).
const HOLD_OUTCOME = 'Nothing was charged for this hold, so there is nothing to refund. The slot goes back to other patients.';
const FREE_BOOKING_OUTCOME = 'Nothing was charged for this booking, so there is nothing to refund.';

type CancelTarget = { rpc: 'cancel_hold' | 'cancel_token' | 'cancel_appointment'; id: string; message: string };

function ActiveTab() {
  const router = useRouter();
  const [tokens, setTokens] = useState<ActiveTokenRow[] | null>(null);
  const [appointments, setAppointments] = useState<ActiveAppointmentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const refetch = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const [tokenRes, apptRes] = await Promise.all([
      supabase.from('tokens').select('id, service_id').eq('patient_id', patientId).in('status', ACTIVE_TOKEN_STATUSES).order('created_at', { ascending: false }),
      supabase
        .from('appointments')
        .select('id, service_id, status, fee_inr, appointment_slots(starts_at), doctors(id, name), services(name)')
        .eq('patient_id', patientId)
        .in('status', ACTIVE_APPOINTMENT_STATUSES),
    ]);

    if (tokenRes.error) {
      setLoadError(mapSupabaseError({ code: tokenRes.error.code, message: tokenRes.error.message }));
      return;
    }
    setTokens((tokenRes.data ?? []) as ActiveTokenRow[]);
    setAppointments((apptRes.data ?? []) as unknown as ActiveAppointmentRow[]);
    setLoadError(null);
  }, []);

  useLiveRefresh(refetch, 10_000);

  async function handleCheckIn(appointmentId: string) {
    const { data, error } = await supabase.rpc('check_in', { p_appointment: appointmentId });
    if (error) {
      showToast(mapSupabaseError({ code: error.code, message: error.message }), 'error');
      refetch();
      return;
    }
    const token = data as { id: string; service_id: string } | null;
    if (token?.id) router.push({ pathname: '/(app)/token/[id]', params: { id: token.id, serviceId: token.service_id } });
  }

  function confirmCancelToken(tokenId: string, status: 'waiting' | 'pending_payment') {
    if (status === 'pending_payment') {
      setCancelTarget({ rpc: 'cancel_hold', id: tokenId, message: HOLD_OUTCOME });
      return;
    }
    // A walk-in ticket is never a scheduled slot -- whether or not it carried a paid fee
    // (start_paid_booking), there's no "before the appointment" refund window to speak of.
    setCancelTarget({ rpc: 'cancel_token', id: tokenId, message: 'This is a walk-in ticket — no refund applies.' });
  }

  // Matches the real policy live since 0059: a paid, booked appointment cancelled 2+ hours
  // before its slot is flagged for an automatic refund (apps/api's refund_job issues it);
  // under 2 hours, no automatic refund, though the hospital can still approve one manually.
  function confirmCancelAppointment(appt: ActiveAppointmentRow) {
    if (appt.status === 'pending_payment') {
      setCancelTarget({ rpc: 'cancel_hold', id: appt.id, message: HOLD_OUTCOME });
      return;
    }
    if (!appt.fee_inr) {
      setCancelTarget({ rpc: 'cancel_appointment', id: appt.id, message: FREE_BOOKING_OUTCOME });
      return;
    }
    const startsAt = one(appt.appointment_slots)?.starts_at ?? null;
    const hoursLeft = startsAt ? new Date(startsAt).getTime() - new Date().getTime() : 0;
    const message =
      startsAt && hoursLeft >= 2 * 60 * 60 * 1000
        ? `You paid ₹${appt.fee_inr} online. Cancelling 2+ hours before your appointment refunds you automatically, to your original payment method.`
        : `You paid ₹${appt.fee_inr} online. Cancelling under 2 hours before your appointment does not refund you automatically -- ask at reception if you'd like one reviewed.`;
    setCancelTarget({ rpc: 'cancel_appointment', id: appt.id, message });
  }

  async function handleConfirmCancel() {
    if (!cancelTarget) return;
    setCancelBusy(true);
    const { error } =
      cancelTarget.rpc === 'cancel_hold'
        ? await supabase.rpc('cancel_hold', { p_id: cancelTarget.id })
        : cancelTarget.rpc === 'cancel_token'
          ? await supabase.rpc('cancel_token', { p_token: cancelTarget.id })
          : await supabase.rpc('cancel_appointment', { p_appointment: cancelTarget.id });
    setCancelBusy(false);
    setCancelTarget(null);
    if (error) {
      showToast(mapSupabaseError({ code: error.code, message: error.message }), 'error');
    } else {
      showToast(cancelTarget.rpc === 'cancel_token' ? 'Ticket cancelled.' : 'Cancelled.', 'success');
    }
    refetch();
  }

  if (tokens === null && !loadError) {
    return (
      <View style={styles.list}>
        <Skeleton height={160} radius={20} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.list}>
        <UIText color="danger">{loadError}</UIText>
      </View>
    );
  }

  const nothingActive = tokens?.length === 0 && appointments?.length === 0;

  return (
    <View style={styles.list}>
      {nothingActive ? (
        <EmptyState
          icon={{ ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' }}
          title="No active tokens"
          text="Take a token from Home to see it here, live."
          action={{ label: 'Take a token', onPress: () => router.push('/(app)/take-token') }}
        />
      ) : (
        <>
          {tokens?.map((t) => (
            <ActiveTokenCard
              key={t.id}
              tokenId={t.id}
              onPress={() => router.push({ pathname: '/(app)/token/[id]', params: { id: t.id, serviceId: t.service_id } })}
              onCancel={(status) => confirmCancelToken(t.id, status)}
            />
          ))}
          {appointments?.map((a) => {
            const doctor = one(a.doctors);
            const doctorId = doctor?.id ?? null;
            return (
              <ActiveAppointmentCard
                key={a.id}
                appt={a}
                doctorId={doctorId}
                doctorName={doctor?.name ?? null}
                onOpenDetails={doctorId ? () => router.push({ pathname: '/(app)/doctor/[doctorId]', params: { doctorId } }) : null}
                onCheckIn={() => handleCheckIn(a.id)}
                onPayNow={() => router.push({ pathname: '/(app)/checkout/[holdId]', params: { holdId: a.id } })}
                onCancel={() => confirmCancelAppointment(a)}
              />
            );
          })}
        </>
      )}

      <BottomSheet visible={!!cancelTarget} onClose={() => setCancelTarget(null)}>
        <View style={styles.confirmSheet}>
          <UIText variant="title3">{cancelTarget?.rpc === 'cancel_hold' ? 'Cancel this hold?' : 'Cancel this booking?'}</UIText>
          <UIText variant="body">{cancelTarget?.message}</UIText>
          <Button label="Keep it" variant="secondary" block onPress={() => setCancelTarget(null)} />
          <Button
            label={cancelTarget?.rpc === 'cancel_hold' ? 'Cancel hold' : cancelTarget?.rpc === 'cancel_token' ? 'Cancel ticket' : 'Cancel booking'}
            variant="danger"
            block
            loading={cancelBusy}
            onPress={handleConfirmCancel}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

// -------------------- Past --------------------

type PastRow = Record<string, unknown> & { id?: string | number; status?: string; doctor_id?: string | null };
type PastItem = { key: string; label: string; status: string; timestamp: string | null; feeInr: number | null };

const TIMESTAMP_KEYS = ['called_at', 'completed_at', 'starts_at', 'updated_at', 'created_at'];
const RESOLUTION_LABEL: Record<string, string> = {
  done: 'Done',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

function pickTimestamp(row: PastRow): string | null {
  for (const key of TIMESTAMP_KEYS) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

async function fetchPastRows(table: 'tokens' | 'appointments', statuses: string[], patientId: string): Promise<PastRow[]> {
  const { data, error } = await supabase.from(table).select('*').eq('patient_id', patientId).in('status', statuses);
  return error ? [] : ((data as PastRow[]) ?? []);
}

function PastTab() {
  const [items, setItems] = useState<PastItem[] | null>(null);

  const refetch = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const [tokens, appointments, servicesRes] = await Promise.all([
      fetchPastRows('tokens', PAST_TOKEN_STATUSES, patientId),
      fetchPastRows('appointments', PAST_APPOINTMENT_STATUSES, patientId),
      supabase.from('services').select('id, name'),
    ]);

    const serviceNames: Record<string, string> = {};
    for (const row of (servicesRes.data ?? []) as { id: string; name: string }[]) serviceNames[row.id] = row.name;

    const label = (row: PastRow) => {
      const serviceId = row.service_id;
      if (typeof serviceId === 'string' && serviceNames[serviceId]) return serviceNames[serviceId];
      return 'Queue ticket';
    };

    const merged: PastItem[] = [
      ...tokens.map((row, i) => ({
        key: `token-${String(row.id ?? i)}`,
        label: label(row),
        status: (row.status as string) ?? 'unknown',
        timestamp: pickTimestamp(row),
        // `tokens.fee_inr` (0051) is denormalized and patient-readable; the `payments` table
        // itself has no anon/authenticated grant (see 0051's own comment) -- refund state isn't
        // visible to a patient from any table this app can read, so this only ever shows Paid.
        feeInr: typeof row.fee_inr === 'number' ? row.fee_inr : null,
      })),
      ...appointments.map((row, i) => ({
        key: `appt-${String(row.id ?? i)}`,
        label: label(row),
        status: (row.status as string) ?? 'unknown',
        timestamp: pickTimestamp(row),
        feeInr: null,
      })),
    ].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));

    setItems(merged);
  }, []);

  useLiveRefresh(refetch, 30_000);

  if (items === null) {
    return (
      <View style={styles.list}>
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.list}>
        <EmptyState
          icon={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
          title="No past visits yet"
          text="Finished, cancelled and skipped tickets show up here."
        />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <Card key={item.key} style={styles.pastRow}>
          <View style={styles.flex}>
            <UIText variant="bodyStrong" numberOfLines={1}>
              {item.label}
            </UIText>
            {item.timestamp ? (
              <UIText variant="secondary">{new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</UIText>
            ) : null}
          </View>
          <View style={styles.pastChips}>
            {item.feeInr != null && item.feeInr > 0 ? <StatusChip status="paid" label={`Paid ${formatFee(item.feeInr)}`} /> : null}
            <UIText variant="secondaryStrong" color="inkSecondary">
              {RESOLUTION_LABEL[item.status] ?? item.status}
            </UIText>
          </View>
        </Card>
      ))}
    </View>
  );
}

// -------------------- Screen --------------------

export default function MyTokens() {
  const theme = useTheme();
  const [tab, setTab] = useState<'active' | 'past'>('active');

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.canvas }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <SectionHeader title="My tokens" />
        <View style={styles.segmentRow}>
          <Chip label="Active" selected={tab === 'active'} onPress={() => setTab('active')} />
          <Chip label="Past" selected={tab === 'past'} onPress={() => setTab('past')} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>{tab === 'active' ? <ActiveTab /> : <PastTab />}</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, gap: 12 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  content: { padding: 16, paddingTop: 12, gap: 12 },
  list: { gap: 12 },
  flex: { flex: 1 },
  activeHeader: { gap: 2, marginBottom: 4 },
  apptCard: { gap: 4, alignItems: 'flex-start' },
  apptHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', gap: 8 },
  apptExplainer: { marginTop: 4, marginBottom: 4 },
  cancelButton: { marginTop: 4, alignSelf: 'flex-start' },
  confirmSheet: { gap: 12, paddingBottom: 8 },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pastChips: { alignItems: 'flex-end', gap: 4 },
});
