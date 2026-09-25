import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isCheckInWindow } from '@/lib/appointmentWindow';
import { formatFee } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Embed<T> = T | T[] | null;

type AppointmentRow = {
  id: string;
  service_id: string;
  doctor_id: string | null;
  status: string;
  appointment_slots: Embed<{ starts_at: string }>;
  doctors: Embed<{ name: string; fee_inr: number }>;
  services: Embed<{ name: string }>;
};

type Appointment = {
  id: string;
  serviceId: string;
  doctorId: string | null;
  startsAt: string | null;
  serviceName: string;
  doctorName: string | null;
  feeInr: number | null;
};

function one<T>(embed: Embed<T>): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function formatSlot(startsAt: string | null) {
  if (!startsAt) return 'Time to be confirmed';
  const d = new Date(startsAt);
  const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * "My appointments" — booking itself now happens per-doctor (Home -> department -> doctor, see
 * (app)/department/[serviceId].tsx and (app)/doctor/[doctorId].tsx), so this tab is just the
 * management view: what's booked, check in when the window opens, cancel otherwise.
 */
export default function AppointmentsScreen() {
  const theme = useTheme();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const { data, error } = await supabase
      .from('appointments')
      .select('id, service_id, doctor_id, status, appointment_slots(starts_at), doctors(name, fee_inr), services(name)')
      .eq('patient_id', patientId)
      .eq('status', 'booked');

    if (error) {
      setLoadError(mapSupabaseError({ code: error.code, message: error.message }));
      return;
    }

    const rows = ((data ?? []) as unknown as AppointmentRow[]).map((row) => {
      const slot = one(row.appointment_slots);
      const doctor = one(row.doctors);
      const service = one(row.services);
      return {
        id: row.id,
        serviceId: row.service_id,
        doctorId: row.doctor_id,
        startsAt: slot?.starts_at ?? null,
        serviceName: service?.name ?? 'Appointment',
        doctorName: doctor?.name ?? null,
        feeInr: doctor?.fee_inr ?? null,
      };
    });
    rows.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
    setAppointments(rows);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel(appt: Appointment) {
    setActionError(null);
    setPendingId(appt.id);
    const { error } = await supabase.rpc('cancel_appointment', { p_appointment: appt.id });
    if (error) setActionError(mapSupabaseError({ code: error.code, message: error.message }));
    await load();
    setPendingId(null);
  }

  async function handleCheckIn(appt: Appointment) {
    setActionError(null);
    setPendingId(appt.id);
    const { data, error } = await supabase.rpc('check_in', { p_appointment: appt.id });
    setPendingId(null);
    if (error) {
      setActionError(mapSupabaseError({ code: error.code, message: error.message }));
      await load();
      return;
    }
    const token = data as { id: string } | null;
    if (token?.id) {
      router.push({ pathname: '/(app)/token/[id]', params: { id: token.id, serviceId: appt.serviceId } });
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="displayMd" style={styles.title}>
          Appointments
        </ThemedText>

        <ScrollView contentContainerStyle={styles.list}>
          <Pressable
            onPress={() => router.push('/(app)/(tabs)')}
            style={({ pressed }) => [
              styles.newAppointmentCard,
              { borderColor: theme.primaryOutline, backgroundColor: theme.primarySoft, opacity: pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="button" themeColor="primaryText">
              Book a new appointment
            </ThemedText>
          </Pressable>

          {actionError ? (
            <View style={[styles.banner, { backgroundColor: theme.dangerSoft, borderLeftColor: theme.danger }]}>
              <ThemedText type="bodySm" themeColor="danger">
                {actionError}
              </ThemedText>
            </View>
          ) : null}

          {appointments === null && !loadError ? <ActivityIndicator color={theme.primary} style={styles.spinner} /> : null}

          {loadError ? (
            <View style={[styles.banner, { backgroundColor: theme.dangerSoft, borderLeftColor: theme.danger }]}>
              <ThemedText type="bodySm" themeColor="danger">
                {loadError}
              </ThemedText>
              <Pressable onPress={load} hitSlop={8} style={styles.retryLink}>
                <ThemedText type="button" themeColor="danger" style={styles.retryText}>
                  Retry
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {appointments && appointments.length === 0 && !loadError ? (
            <View style={styles.emptyState}>
              <ThemedText type="body" themeColor="inkSecondary" style={styles.emptyText}>
                No upcoming appointments.
              </ThemedText>
            </View>
          ) : null}

          {appointments?.map((appt) => {
            const busy = pendingId === appt.id;
            const canCheckIn = appt.startsAt ? isCheckInWindow(new Date(appt.startsAt), new Date()) : false;

            return (
              <View key={appt.id} style={[styles.slotCard, CardShadow, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
                <ThemedText type="headingSm">{appt.serviceName}</ThemedText>
                {appt.doctorName ? (
                  <ThemedText type="bodySm" themeColor="inkSecondary">
                    Dr. {appt.doctorName}
                    {appt.feeInr != null ? ` · ${formatFee(appt.feeInr)}` : ''}
                  </ThemedText>
                ) : null}
                <ThemedText type="bodyLg">{formatSlot(appt.startsAt)}</ThemedText>

                <View style={styles.actions}>
                  {canCheckIn ? (
                    <Pressable
                      disabled={busy}
                      onPress={() => handleCheckIn(appt)}
                      style={[styles.button, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
                      {busy ? (
                        <ActivityIndicator color={theme.onPrimary} />
                      ) : (
                        <ThemedText type="button" themeColor="onPrimary">
                          Check in
                        </ThemedText>
                      )}
                    </Pressable>
                  ) : null}
                  <Pressable
                    disabled={busy}
                    onPress={() => handleCancel(appt)}
                    style={[styles.buttonOutline, { borderColor: theme.primaryOutline, opacity: busy ? 0.6 : 1 }]}>
                    {busy && !canCheckIn ? (
                      <ActivityIndicator color={theme.ink} />
                    ) : (
                      <ThemedText type="button" themeColor="ink">
                        Cancel
                      </ThemedText>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  title: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  list: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  spinner: { marginTop: Spacing.lg },
  banner: { borderRadius: Rounded.md, padding: Spacing.md, gap: Spacing.xs, borderLeftWidth: 3 },
  retryLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: { textDecorationLine: 'underline' },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText: { textAlign: 'center' },
  newAppointmentCard: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCard: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  actions: { flexDirection: 'row', gap: Spacing.xs },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOutline: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
