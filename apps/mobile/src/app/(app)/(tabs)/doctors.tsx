import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrioritySheet, type PriorityLane } from '@/components/booking/PrioritySheet';
import {
  AnimatedPressable,
  BottomSheet,
  Chip,
  DoctorCard,
  EmptyState,
  SectionHeader,
  Skeleton,
  StatusChip,
  StickyBottomBar,
  Type,
  UIText,
  usePressScale,
  useStickyBottomBarHeight,
} from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import {
  doctorCardStatus,
  fetchAllDoctors,
  fetchDoctor,
  fetchNextSlots,
  formatFee,
  type DoctorWithService,
  type DoctorWithStatus,
  type NextSlot,
} from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { startPaidAppointment, startPaidBooking } from '@/lib/paid-booking';
import { showToast } from '@/lib/toast-store';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRequireCompleteProfile } from '@/lib/use-require-complete-profile';

const ALL_DEPARTMENTS = 'All';

export default function Doctors() {
  const theme = useTheme();
  const ready = useRequireCompleteProfile();

  const [doctors, setDoctors] = useState<DoctorWithService[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setDoctors(await fetchAllDoctors());
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load doctors right now — check your connection and try again.");
    }
  }, []);

  useLiveRefresh(refetch, 15_000);

  const departments = useMemo(() => {
    if (!doctors) return [ALL_DEPARTMENTS];
    return [ALL_DEPARTMENTS, ...Array.from(new Set(doctors.map((d) => d.serviceName))).sort()];
  }, [doctors]);

  const filtered = useMemo(() => {
    if (!doctors) return [];
    const query = search.trim().toLowerCase();
    return doctors.filter((d) => {
      if (department !== ALL_DEPARTMENTS && d.serviceName !== department) return false;
      if (!query) return true;
      return d.name.toLowerCase().includes(query) || d.specialty.toLowerCase().includes(query);
    });
  }, [doctors, search, department]);

  if (!ready) return null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.canvas }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <SectionHeader title="Doctors" />
        <View style={[styles.searchBox, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
          <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.inkMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search doctors or specialties"
            placeholderTextColor={theme.inkMuted}
            style={[styles.searchInput, { color: theme.ink, fontFamily: Type.body.fontFamily }]}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {departments.map((dept) => (
            <Chip key={dept} label={dept} selected={department === dept} onPress={() => setDepartment(dept)} />
          ))}
        </ScrollView>
      </View>

      {doctors === null && !loadError ? (
        <ScrollView contentContainerStyle={styles.list}>
          <Skeleton height={96} />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </ScrollView>
      ) : loadError ? (
        <View style={styles.list}>
          <UIText color="danger">{loadError}</UIText>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.list}>
          <EmptyState
            icon={{ ios: 'stethoscope', android: 'stethoscope', web: 'stethoscope' }}
            title="No doctors match"
            text="Try a different search or department."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.map((doctor) => (
            <DoctorCard
              key={doctor.id}
              name={doctor.name}
              department={doctor.serviceName}
              feeInr={doctor.fee_inr}
              status={doctorCardStatus(doctor)}
              actionLabel={`Book · ${formatFee(doctor.fee_inr)}`}
              onPress={() => setSelectedDoctorId(doctor.id)}
              onAction={() => setSelectedDoctorId(doctor.id)}
            />
          ))}
        </ScrollView>
      )}

      <DoctorDetailSheet doctorId={selectedDoctorId} onClose={() => setSelectedDoctorId(null)} />
    </SafeAreaView>
  );
}

function DoctorDetailSheet({ doctorId, onClose }: { doctorId: string | null; onClose: () => void }) {
  const router = useRouter();
  const barHeight = useStickyBottomBarHeight();
  const [doctor, setDoctor] = useState<DoctorWithStatus | null>(null);
  const [nextSlots, setNextSlots] = useState<NextSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  // No reset-on-close branch: the sheet is invisible while closed (BottomSheet keeps its content
  // mounted only for the close animation), and the next doctor's data overwrites this on its own
  // open -- a synchronous setState here for "closed" would itself trip
  // react-hooks/set-state-in-effect for no visible benefit.
  useEffect(() => {
    if (!doctorId) return;
    let cancelled = false;
    Promise.all([fetchDoctor(doctorId), fetchNextSlots(doctorId)]).then(([doc, slots]) => {
      if (cancelled) return;
      setDoctor(doc);
      setNextSlots(slots);
      setSelectedSlotId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  function goToCheckout(holdId: string) {
    onClose();
    router.push({ pathname: '/(app)/checkout/[holdId]', params: { holdId } });
  }

  // A selected slot pill mints a paid hold for THAT time (start_paid_appointment); with no slot
  // picked it's a walk-in hold for the doctor today (start_paid_booking) -- these are different
  // RPCs (0039 vs 0052), never interchangeable, per Payment work/the orchestrator's rule. Both
  // ask the priority question first (PrioritySheet) before minting the hold.
  function handleBookAndPay() {
    if (!doctor || booking) return;
    setPriorityOpen(true);
  }

  async function handlePriorityConfirm(lane: PriorityLane, note: string | null) {
    setPriorityOpen(false);
    if (!doctor) return;
    setBooking(true);
    const result = selectedSlotId
      ? await startPaidAppointment(selectedSlotId, lane, note)
      : await startPaidBooking(doctor.id, lane, note);
    setBooking(false);
    if (!result.ok) {
      showToast(mapSupabaseError({ code: undefined, message: result.error }), 'error');
      return;
    }
    goToCheckout('tokenId' in result ? result.tokenId : result.holdId);
  }

  return (
    <>
    <BottomSheet visible={!!doctorId} onClose={onClose}>
      {!doctor ? (
        <View style={styles.sheetLoading}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={16} width="40%" />
          <Skeleton height={100} />
        </View>
      ) : (
        <View style={{ paddingBottom: barHeight }}>
          <View style={styles.sheetHeader}>
            <UIText variant="title3">{doctor.name}</UIText>
            <StatusChip status={doctorCardStatus(doctor)} />
          </View>
          <UIText variant="secondary" style={styles.sheetSpecialty}>
            {doctor.specialty}
            {doctor.qualification ? ` · ${doctor.qualification}` : ''}
          </UIText>
          {doctor.room ? <UIText variant="secondary">Room {doctor.room}</UIText> : null}

          <UIText variant="secondaryStrong" style={styles.sheetLabel}>
            Today
          </UIText>
          <UIText variant="body">{doctor.todayShifts.length > 0 ? doctor.todayShifts.join(', ') : 'No shifts scheduled today'}</UIText>

          {nextSlots.length > 0 ? (
            <>
              <UIText variant="secondaryStrong" style={styles.sheetLabel}>
                Next slots — tap to book that time, or leave none picked for a walk-in today
              </UIText>
              <View style={styles.slotRow}>
                {nextSlots.map((slot) => (
                  <SlotPill
                    key={slot.id}
                    label={slot.label}
                    selected={selectedSlotId === slot.id}
                    onPress={() => setSelectedSlotId((current) => (current === slot.id ? null : slot.id))}
                  />
                ))}
              </View>
            </>
          ) : null}
        </View>
      )}

      {doctor ? (
        <StickyBottomBar
          total={formatFee(doctor.fee_inr)}
          totalLabel="Consultation fee"
          cta={`Book · ${formatFee(doctor.fee_inr)}`}
          onPress={handleBookAndPay}
          loading={booking}
          disabled={doctor.onLeaveToday}
        />
      ) : null}
    </BottomSheet>
    <PrioritySheet visible={priorityOpen} onClose={() => setPriorityOpen(false)} onConfirm={handlePriorityConfirm} />
    </>
  );
}

function SlotPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const press = usePressScale(0.95);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.pill,
        { borderColor: selected ? theme.primary : theme.primaryOutline, backgroundColor: selected ? theme.primary : theme.primarySoft },
        press.style,
      ]}>
      <UIText variant="secondaryStrong" color={selected ? 'onPrimary' : 'primaryText'}>
        {label}
      </UIText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, gap: 12, paddingBottom: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, height: 48 },
  searchInput: { flex: 1, fontSize: 17, height: 48 },
  chipRow: { gap: 8 },
  list: { padding: 16, paddingTop: 4, gap: 12 },
  sheetLoading: { gap: 12, paddingVertical: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  sheetSpecialty: { marginBottom: 4 },
  sheetLabel: { marginTop: 16, marginBottom: 6 },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 20, minHeight: 56, justifyContent: 'center' },
});
