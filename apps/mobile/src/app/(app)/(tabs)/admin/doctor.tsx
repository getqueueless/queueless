import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, ChipRow, OutlineButton, PrimaryButton } from '@/components/admin/controls';
import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DOCTOR_STATUS_LABELS, hhmm, isDate, timeRangeError, WEEKDAYS } from '@/lib/admin-doctors';
import type { Doctor, DoctorStatusValue } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Every write here is an admin_* RPC from supabase/migrations/0038_doctors_schedules.sql (org
// and admin role re-checked server-side); reads are the public doctor tables. Doctors are never
// hard-deleted — "Active" off hides them from patients and keeps their history.

type Window = { id: string; weekday: number; start_time: string; end_time: string; max_patients?: number; slot_minutes?: number };
type Leave = { id: string; from_date: string; to_date: string; reason: string | null };
type Status = { status: DoctorStatusValue; late_minutes: number | null };
type Draft = { name: string; specialty: string; qualification: string; room: string; fee: string; serviceId: string | null; active: boolean; photoUrl: string | null };

const EMPTY_DRAFT: Draft = { name: '', specialty: '', qualification: '', room: '', fee: '0', serviceId: null, active: true, photoUrl: null };
const WEEKDAY_OPTIONS = WEEKDAYS.map((label, value) => ({ value, label }));
const STATUS_OPTIONS = (Object.keys(DOCTOR_STATUS_LABELS) as DoctorStatusValue[]).map((value) => ({ value, label: DOCTOR_STATUS_LABELS[value] }));

function toDraft(d: Doctor): Draft {
  return {
    name: d.name,
    specialty: d.specialty,
    qualification: d.qualification ?? '',
    room: d.room ?? '',
    fee: String(d.fee_inr),
    serviceId: d.service_id,
    active: d.active,
    photoUrl: d.photo_url,
  };
}

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <ThemedText type="bodySm" themeColor="danger">
      {message}
    </ThemedText>
  ) : null;
}

export default function AdminDoctor() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [shifts, setShifts] = useState<Window[]>([]);
  const [breaks, setBreaks] = useState<Window[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [status, setStatus] = useState<Status>({ status: 'available', late_minutes: null });

  // The details form is loaded once, then left alone: the 15 s refresh below must never
  // overwrite what the admin is typing. Only the lists and today's status stay live.
  const detailsLoaded = useRef(false);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const svcRes = await supabase.from('services').select('id, name').eq('org_id', orgId).order('name');
    if (svcRes.error) {
      setLoadError(mapSupabaseError(svcRes.error));
      return;
    }
    setServices((svcRes.data ?? []) as { id: string; name: string }[]);
    if (isNew) {
      setReady(true);
      return;
    }

    const [docRes, shiftRes, breakRes, leaveRes, statusRes] = await Promise.all([
      supabase
        .from('doctors')
        .select('id, org_id, service_id, name, specialty, qualification, room, photo_url, fee_inr, active')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('doctor_schedules').select('id, weekday, start_time, end_time, max_patients, slot_minutes').eq('doctor_id', id).order('weekday').order('start_time'),
      supabase.from('doctor_breaks').select('id, weekday, start_time, end_time').eq('doctor_id', id).order('weekday').order('start_time'),
      supabase.from('doctor_leaves').select('id, from_date, to_date, reason').eq('doctor_id', id).order('from_date'),
      supabase.from('doctor_status_today').select('status, late_minutes').eq('doctor_id', id).maybeSingle(),
    ]);
    const error = docRes.error ?? shiftRes.error ?? breakRes.error ?? leaveRes.error ?? statusRes.error;
    if (error || !docRes.data) {
      setLoadError(error ? mapSupabaseError(error) : 'We could not find that doctor.');
      return;
    }
    setLoadError(null);
    if (!detailsLoaded.current) {
      detailsLoaded.current = true;
      setDraft(toDraft(docRes.data as Doctor));
    }
    setShifts((shiftRes.data ?? []) as Window[]);
    setBreaks((breakRes.data ?? []) as Window[]);
    setLeaves((leaveRes.data ?? []) as Leave[]);
    if (statusRes.data) setStatus(statusRes.data as Status);
    setReady(true);
  }, [orgId, id, isNew]);
  useLiveRefresh(refetch);

  async function saveDetails() {
    const fee = Number(draft.fee);
    if (!draft.name.trim() || !draft.specialty.trim()) return setSaveError('Name and specialty are required.');
    if (!draft.serviceId) return setSaveError('Pick the department this doctor works in.');
    if (!Number.isInteger(fee) || fee < 0) return setSaveError('Fee must be a whole number of rupees, 0 or more.');
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const { data, error } = await supabase.rpc('admin_upsert_doctor', {
      p_id: isNew ? null : id,
      p_service_id: draft.serviceId,
      p_name: draft.name.trim(),
      p_specialty: draft.specialty.trim(),
      p_qualification: draft.qualification.trim() || null,
      p_room: draft.room.trim() || null,
      p_photo_url: draft.photoUrl,
      p_fee_inr: fee,
      p_active: draft.active,
    });
    setSaving(false);
    if (error) return setSaveError(mapSupabaseError(error));
    setSaved(true);
    if (isNew && data?.id) router.replace(`/admin/doctor?id=${data.id}` as Href);
  }

  if (roleLoading || (orgId && !ready && !loadError)) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!orgId ? (
            <StateCard kind="error" message="No organization assigned to this account." />
          ) : loadError ? (
            <StateCard kind="error" message={loadError} />
          ) : (
            <>
              <Card>
                <ThemedText type="headingSm">{isNew ? 'New doctor' : 'Details'}</ThemedText>
                <LabeledInput label="Name" value={draft.name} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} />
                <LabeledInput label="Specialty" value={draft.specialty} onChangeText={(v) => setDraft((d) => ({ ...d, specialty: v }))} />
                <LabeledInput
                  label="Qualification (optional)"
                  value={draft.qualification}
                  onChangeText={(v) => setDraft((d) => ({ ...d, qualification: v }))}
                />
                <LabeledInput label="Room (optional)" value={draft.room} onChangeText={(v) => setDraft((d) => ({ ...d, room: v }))} />
                <LabeledInput
                  label="Consultation fee (₹)"
                  value={draft.fee}
                  onChangeText={(v) => setDraft((d) => ({ ...d, fee: v }))}
                  keyboardType="number-pad"
                />
                <ThemedText type="caption" themeColor="inkMuted">
                  Department
                </ThemedText>
                <ChipRow
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                  value={draft.serviceId}
                  onChange={(v) => setDraft((d) => ({ ...d, serviceId: v }))}
                />
                <View style={styles.switchRow}>
                  <ThemedText type="body">Active (visible to patients)</ThemedText>
                  <Switch
                    value={draft.active}
                    onValueChange={(v) => setDraft((d) => ({ ...d, active: v }))}
                    trackColor={{ false: theme.hairline, true: theme.primaryOutline }}
                    thumbColor={draft.active ? theme.primary : theme.surface}
                  />
                </View>
                <ErrorText message={saveError} />
                {saved ? (
                  <ThemedText type="bodySm" themeColor="success">
                    Saved.
                  </ThemedText>
                ) : null}
                <PrimaryButton label={isNew ? 'Add doctor' : 'Save details'} onPress={saveDetails} busy={saving} />
              </Card>

              {isNew ? null : (
                <>
                  <StatusCard doctorId={id} current={status} onChanged={refetch} />
                  <WeeklyWindows doctorId={id} kind="shift" rows={shifts} onChanged={refetch} />
                  <WeeklyWindows doctorId={id} kind="break" rows={breaks} onChanged={refetch} />
                  <LeavesCard doctorId={id} rows={leaves} onChanged={refetch} />
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StatusCard({ doctorId, current, onChanged }: { doctorId: string; current: Status; onChanged: () => void }) {
  const [picked, setPicked] = useState<DoctorStatusValue | null>(null);
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = picked ?? current.status;

  async function save() {
    const late = Number(minutes);
    if (value === 'running_late' && (!Number.isInteger(late) || late <= 0)) return setError('Enter how many minutes late.');
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_doctor_status', {
      p_doctor: doctorId,
      p_status: value,
      p_late_minutes: value === 'running_late' ? late : null,
    });
    setBusy(false);
    if (rpcError) return setError(mapSupabaseError(rpcError));
    setPicked(null);
    setMinutes('');
    onChanged();
  }

  return (
    <Card>
      <ThemedText type="headingSm">Today&apos;s status</ThemedText>
      <ThemedText type="bodySm" themeColor="inkSecondary">
        Now: {current.status === 'running_late' && current.late_minutes ? `Running ${current.late_minutes} min late` : DOCTOR_STATUS_LABELS[current.status]}
      </ThemedText>
      <ChipRow options={STATUS_OPTIONS} value={value} onChange={setPicked} />
      {value === 'running_late' ? (
        <LabeledInput label="Minutes late" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" />
      ) : null}
      <ErrorText message={error} />
      <PrimaryButton label="Update status" onPress={save} busy={busy} />
    </Card>
  );
}

function WeeklyWindows({ doctorId, kind, rows, onChanged }: { doctorId: string; kind: 'shift' | 'break'; rows: Window[]; onChanged: () => void }) {
  const isShift = kind === 'shift';
  const [editId, setEditId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState(isShift ? '09:00' : '13:00');
  const [end, setEnd] = useState(isShift ? '13:00' : '13:30');
  const [max, setMax] = useState('20');
  const [slot, setSlot] = useState('15');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: Window) {
    setEditId(row.id);
    setWeekday(row.weekday);
    setStart(hhmm(row.start_time));
    setEnd(hhmm(row.end_time));
    if (isShift) {
      setMax(String(row.max_patients ?? 20));
      setSlot(String(row.slot_minutes ?? 15));
    }
    setError(null);
  }

  function reset() {
    setEditId(null);
    setError(null);
  }

  async function save() {
    const rangeError = timeRangeError(start, end);
    if (rangeError) return setError(rangeError);
    const base = { p_id: editId, p_doctor_id: doctorId, p_weekday: weekday, p_start_time: start, p_end_time: end };
    let result;
    setBusy(true);
    setError(null);
    if (isShift) {
      const m = Number(max);
      const s = Number(slot);
      if (!Number.isInteger(m) || m <= 0 || !Number.isInteger(s) || s <= 0) {
        setBusy(false);
        return setError('Patients and slot minutes must be whole numbers above 0.');
      }
      result = await supabase.rpc('admin_upsert_doctor_schedule', { ...base, p_max_patients: m, p_slot_minutes: s });
    } else {
      result = await supabase.rpc('admin_upsert_doctor_break', base);
    }
    setBusy(false);
    if (result.error) return setError(mapSupabaseError(result.error));
    reset();
    onChanged();
  }

  async function remove(rowId: string) {
    setError(null);
    const { error: rpcError } = await supabase.rpc(isShift ? 'admin_delete_doctor_schedule' : 'admin_delete_doctor_break', { p_id: rowId });
    if (rpcError) return setError(mapSupabaseError(rpcError));
    if (editId === rowId) reset();
    onChanged();
  }

  return (
    <Card>
      <ThemedText type="headingSm">{isShift ? 'Weekly shifts' : 'Breaks'}</ThemedText>
      {rows.length === 0 ? (
        <ThemedText type="bodySm" themeColor="inkMuted">
          {isShift ? 'No shifts yet — patients cannot book this doctor.' : 'No breaks.'}
        </ThemedText>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={styles.listRow}>
            <ThemedText type="body" style={styles.flex}>
              {WEEKDAYS[r.weekday]} {hhmm(r.start_time)}–{hhmm(r.end_time)}
              {isShift ? ` · ${r.max_patients} patients · ${r.slot_minutes} min` : ''}
            </ThemedText>
            <OutlineButton label="Edit" onPress={() => edit(r)} />
            <OutlineButton label="Delete" danger onPress={() => remove(r.id)} />
          </View>
        ))
      )}
      <ThemedText type="caption" themeColor="inkMuted">
        {editId ? 'Edit' : 'Add'} {isShift ? 'shift' : 'break'}
      </ThemedText>
      <ChipRow options={WEEKDAY_OPTIONS} value={weekday} onChange={setWeekday} />
      <View style={styles.pair}>
        <View style={styles.flex}>
          <LabeledInput label="Start (HH:MM)" value={start} onChangeText={setStart} maxLength={5} />
        </View>
        <View style={styles.flex}>
          <LabeledInput label="End (HH:MM)" value={end} onChangeText={setEnd} maxLength={5} />
        </View>
      </View>
      {isShift ? (
        <View style={styles.pair}>
          <View style={styles.flex}>
            <LabeledInput label="Max patients" value={max} onChangeText={setMax} keyboardType="number-pad" />
          </View>
          <View style={styles.flex}>
            <LabeledInput label="Slot minutes" value={slot} onChangeText={setSlot} keyboardType="number-pad" />
          </View>
        </View>
      ) : null}
      <ErrorText message={error} />
      <View style={styles.pair}>
        <PrimaryButton label={editId ? 'Save' : 'Add'} onPress={save} busy={busy} />
        {editId ? <OutlineButton label="Cancel" onPress={reset} /> : null}
      </View>
    </Card>
  );
}

function LeavesCard({ doctorId, rows, onChanged }: { doctorId: string; rows: Leave[]; onChanged: () => void }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: Leave) {
    setEditId(row.id);
    setFrom(row.from_date);
    setTo(row.to_date);
    setReason(row.reason ?? '');
    setError(null);
  }

  function reset() {
    setEditId(null);
    setFrom('');
    setTo('');
    setReason('');
    setError(null);
  }

  async function save() {
    if (!isDate(from) || !isDate(to)) return setError('Use dates like 2026-10-02.');
    if (to < from) return setError('The last day can’t be before the first day.');
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_upsert_doctor_leave', {
      p_id: editId,
      p_doctor_id: doctorId,
      p_from_date: from,
      p_to_date: to,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (rpcError) return setError(mapSupabaseError(rpcError));
    reset();
    onChanged();
  }

  async function remove(rowId: string) {
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_delete_doctor_leave', { p_id: rowId });
    if (rpcError) return setError(mapSupabaseError(rpcError));
    if (editId === rowId) reset();
    onChanged();
  }

  return (
    <Card>
      <ThemedText type="headingSm">Leave</ThemedText>
      {rows.length === 0 ? (
        <ThemedText type="bodySm" themeColor="inkMuted">
          No leave booked.
        </ThemedText>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={styles.listRow}>
            <ThemedText type="body" style={styles.flex}>
              {r.from_date === r.to_date ? r.from_date : `${r.from_date} → ${r.to_date}`}
              {r.reason ? ` · ${r.reason}` : ''}
            </ThemedText>
            <OutlineButton label="Edit" onPress={() => edit(r)} />
            <OutlineButton label="Delete" danger onPress={() => remove(r.id)} />
          </View>
        ))
      )}
      <ThemedText type="caption" themeColor="inkMuted">
        {editId ? 'Edit leave' : 'Add leave'}
      </ThemedText>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <LabeledInput label="First day (YYYY-MM-DD)" value={from} onChangeText={setFrom} maxLength={10} />
        </View>
        <View style={styles.flex}>
          <LabeledInput label="Last day (YYYY-MM-DD)" value={to} onChangeText={setTo} maxLength={10} />
        </View>
      </View>
      <LabeledInput label="Reason (optional)" value={reason} onChangeText={setReason} />
      <ErrorText message={error} />
      <View style={styles.pair}>
        <PrimaryButton label={editId ? 'Save' : 'Add leave'} onPress={save} busy={busy} />
        {editId ? <OutlineButton label="Cancel" onPress={reset} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  pair: { flexDirection: 'row', gap: Spacing.xs },
  flex: { flex: 1 },
});
