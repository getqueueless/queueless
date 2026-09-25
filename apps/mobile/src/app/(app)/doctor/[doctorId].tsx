import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isCheckInWindow } from '@/lib/appointmentWindow';
import { doctorStatusLabel, fetchDoctor, formatFee, type DoctorWithStatus } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { startPaidBooking } from '@/lib/paid-booking';
import { supabase } from '@/lib/supabase';
import { useRequireCompleteProfile } from '@/lib/use-require-complete-profile';

type Slot = { id: string; doctor_id: string; service_id: string; starts_at: string };
type Appointment = { id: string; slot_id: string; status: string };

function formatSlot(startsAt: string) {
  const d = new Date(startsAt);
  const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function DoctorDetail() {
  const params = useLocalSearchParams<{ doctorId: string }>();
  const doctorId = params.doctorId;
  const router = useRouter();
  const theme = useTheme();
  const ready = useRequireCompleteProfile();

  const [doctor, setDoctor] = useState<DoctorWithStatus | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  async function load() {
    if (!doctorId) return;
    try {
      const { data: auth } = await supabase.auth.getSession();
      const patientId = auth.session?.user.id;

      const [doctorRow, slotsRes, apptRes] = await Promise.all([
        fetchDoctor(doctorId),
        supabase
          .from('appointment_slots')
          .select('id, doctor_id, service_id, starts_at')
          .eq('doctor_id', doctorId)
          .gt('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true }),
        patientId
          ? supabase.from('appointments').select('id, slot_id, status').eq('patient_id', patientId).eq('status', 'booked')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (slotsRes.error) throw slotsRes.error;
      setDoctor(doctorRow);
      setSlots((slotsRes.data ?? []) as Slot[]);
      setMyAppointments((apptRes.data ?? []) as Appointment[]);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load this doctor's slots right now — check your connection and try again.");
    }
  }

  useEffect(() => {
    if (!ready) return;
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() is redefined every render from doctorId (already listed) plus stable setters; adding it here would re-run the effect every render.
  }, [ready, doctorId]);

  function findMine(slot: Slot) {
    return myAppointments.find((a) => a.slot_id === slot.id);
  }

  async function handleBook(slot: Slot) {
    setActionError(null);
    setPendingId(slot.id);
    const { error } = await supabase.rpc('book_appointment', { p_slot: slot.id });
    if (error) setActionError(mapSupabaseError({ code: error.code, message: error.message }));
    await load();
    setPendingId(null);
  }

  // Book & pay: skips the slot list entirely -- a token minted right now, paid online, no
  // appointment slot involved (a separate flow from Book/Check-in/Cancel above, same split the
  // web app's /my page uses between "Take a token" and appointment booking). Mints the hold here,
  // then hands off to the checkout review screen -- it owns the actual payment step.
  async function handlePayBooking() {
    if (!doctorId) return;
    setActionError(null);
    setPayBusy(true);
    const result = await startPaidBooking(doctorId);
    setPayBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.push({ pathname: '/(app)/checkout/[holdId]', params: { holdId: result.tokenId } });
  }

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
    if (token?.id && doctor) {
      router.push({ pathname: '/(app)/token/[id]', params: { id: token.id, serviceId: doctor.service_id } });
    }
  }

  if (!ready) return null;

  return (
    <ThemedView type="canvas" style={styles.container}>
      <Stack.Screen options={{ title: doctor?.name ?? 'Doctor' }} />
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.flex}>
        {!doctor && !loadError ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : loadError && !doctor ? (
          <View style={styles.centerFill}>
            <ThemedText type="body" themeColor="inkMuted" style={styles.centerText}>
              {loadError}
            </ThemedText>
          </View>
        ) : doctor ? (
          <ScrollView contentContainerStyle={styles.list}>
            <ThemedView type="surface" style={[styles.profileCard, CardShadow, { borderColor: theme.hairline }]}>
              <ThemedText type="headingLg">{doctor.name}</ThemedText>
              <ThemedText type="body" themeColor="inkSecondary">
                {doctor.specialty}
                {doctor.qualification ? ` · ${doctor.qualification}` : ''}
              </ThemedText>
              {doctor.room ? (
                <ThemedText type="bodySm" themeColor="inkMuted">
                  Room {doctor.room}
                </ThemedText>
              ) : null}
              <View style={styles.profileMetaRow}>
                <ThemedText type="bodyLg" themeColor="primaryText">
                  {formatFee(doctor.fee_inr)} consultation
                </ThemedText>
                <ThemedText type="bodySm" themeColor={doctor.status === 'available' && !doctor.onLeaveToday ? 'success' : 'warning'}>
                  {doctorStatusLabel(doctor)}
                </ThemedText>
              </View>
              <ThemedText type="caption" themeColor="inkMuted">
                {doctor.todayShifts.length > 0 ? `Today: ${doctor.todayShifts.join(', ')}` : 'No shifts scheduled today'}
              </ThemedText>
              <Pressable
                disabled={payBusy}
                onPress={handlePayBooking}
                style={[styles.button, styles.payButton, { backgroundColor: theme.primary, opacity: payBusy ? 0.6 : 1 }]}>
                {payBusy ? (
                  <ActivityIndicator color={theme.onPrimary} />
                ) : (
                  <ThemedText type="button" themeColor="onPrimary">
                    Book & pay
                  </ThemedText>
                )}
              </Pressable>
            </ThemedView>

            <ThemedText type="headingSm" style={styles.sectionLabel}>
              Upcoming slots
            </ThemedText>

            {actionError ? (
              <ThemedText type="bodySm" themeColor="danger">
                {actionError}
              </ThemedText>
            ) : null}

            {slots && slots.length === 0 ? (
              <ThemedText type="body" themeColor="inkMuted" style={styles.centerText}>
                No upcoming slots for this doctor.
              </ThemedText>
            ) : null}

            {slots?.map((slot) => {
              const mine = findMine(slot);
              const busy = pendingId === slot.id || (!!mine && pendingId === mine.id);
              const canCheckIn = mine ? isCheckInWindow(new Date(slot.starts_at), new Date()) : false;

              return (
                <View key={slot.id} style={[styles.slotCard, CardShadow, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
                  <ThemedText type="bodyLg">{formatSlot(slot.starts_at)}</ThemedText>

                  {mine ? (
                    <View style={styles.actions}>
                      {canCheckIn ? (
                        <Pressable
                          disabled={busy}
                          onPress={() => handleCheckIn(mine)}
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
                        onPress={() => handleCancel(mine)}
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
                  ) : (
                    <Pressable
                      disabled={busy}
                      onPress={() => handleBook(slot)}
                      style={[styles.button, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
                      {busy ? (
                        <ActivityIndicator color={theme.onPrimary} />
                      ) : (
                        <ThemedText type="button" themeColor="onPrimary">
                          Book
                        </ThemedText>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  centerText: { textAlign: 'center' },
  list: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  profileCard: { borderWidth: 1, borderRadius: Rounded.xl, padding: Spacing.lg, gap: Spacing.xxs },
  profileMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xs },
  payButton: { marginTop: Spacing.sm, alignSelf: 'flex-start' },
  sectionLabel: { marginTop: Spacing.sm },
  slotCard: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.lg, gap: Spacing.sm },
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
