import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QueueTracker, type TrackerStatus } from '@/components/motion/QueueTracker';
import { useEtaAtJoin, useNowServing } from '@/components/motion/use-queue-extras';
import { Button, Card, Chip, EmptyState, SectionHeader, Skeleton, StatusChip, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { formatFee } from '@/lib/doctors';
import { isCheckInWindow } from '@/lib/appointmentWindow';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { mapSupabaseError } from '@/lib/errors';
import { showToast } from '@/lib/toast-store';

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

function ActiveTokenCard({ tokenId, onPress }: { tokenId: string; onPress: () => void }) {
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
    <Card onPress={onPress} accessibilityLabel={`Ticket ${status.code}, ${status.service_name}`}>
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
    </Card>
  );
}

const ACTIVE_APPOINTMENT_STATUSES = ['pending_payment', 'booked'];

type ActiveAppointmentRow = {
  id: string;
  service_id: string;
  status: string;
  appointment_slots: Embed<{ starts_at: string }>;
  doctors: Embed<{ name: string }>;
  services: Embed<{ name: string }>;
};

function formatSlot(startsAt: string) {
  const d = new Date(startsAt);
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function ActiveAppointmentCard({ appt, onCheckIn, onPayNow }: { appt: ActiveAppointmentRow; onCheckIn: () => void; onPayNow: () => void }) {
  const startsAt = one(appt.appointment_slots)?.starts_at ?? null;
  const doctorName = one(appt.doctors)?.name ?? null;
  const serviceName = one(appt.services)?.name ?? 'Appointment';
  const pendingPayment = appt.status === 'pending_payment';
  const canCheckIn = !pendingPayment && startsAt ? isCheckInWindow(new Date(startsAt), new Date()) : false;

  return (
    <Card style={styles.apptCard}>
      <View style={styles.apptHeaderRow}>
        <UIText variant="bodyStrong">{serviceName}</UIText>
        {pendingPayment ? <StatusChip status="pending" label="Payment pending" /> : null}
      </View>
      {doctorName ? <UIText variant="secondary">Dr. {doctorName}</UIText> : null}
      <UIText variant="body">{startsAt ? formatSlot(startsAt) : 'Time to be confirmed'}</UIText>
      {pendingPayment ? (
        <Button label="Pay now" size="md" onPress={onPayNow} />
      ) : canCheckIn ? (
        <Button label="Check in" size="md" onPress={onCheckIn} />
      ) : null}
    </Card>
  );
}

function ActiveTab() {
  const router = useRouter();
  const [tokens, setTokens] = useState<ActiveTokenRow[] | null>(null);
  const [appointments, setAppointments] = useState<ActiveAppointmentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const [tokenRes, apptRes] = await Promise.all([
      supabase.from('tokens').select('id, service_id').eq('patient_id', patientId).in('status', ACTIVE_TOKEN_STATUSES).order('created_at', { ascending: false }),
      supabase
        .from('appointments')
        .select('id, service_id, status, appointment_slots(starts_at), doctors(name), services(name)')
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
            />
          ))}
          {appointments?.map((a) => (
            <ActiveAppointmentCard
              key={a.id}
              appt={a}
              onCheckIn={() => handleCheckIn(a.id)}
              onPayNow={() => router.push({ pathname: '/(app)/checkout/[holdId]', params: { holdId: a.id } })}
            />
          ))}
        </>
      )}
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
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pastChips: { alignItems: 'flex-end', gap: 4 },
});
