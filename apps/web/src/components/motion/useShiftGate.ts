"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { istNow, shiftGate, type ShiftGate } from "./shift-gate";

export type DoctorGate = ShiftGate & { doctorName: string };

// Reads the token's doctor and that doctor's schedule for today (both
// anon-readable), and re-checks the clock every 30s so the view flips to
// the live ETA on its own when the shift starts. null: no doctor, no
// schedule today, or the doctor is on shift.
export function useShiftGate(tokenId: string): DoctorGate | null {
  const [info, setInfo] = useState<{ name: string; shifts: { start_time: string; end_time: string }[] } | null>(null);
  const [gate, setGate] = useState<DoctorGate | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data: token } = await supabase.from("tokens").select("doctor_id").eq("id", tokenId).maybeSingle();
      const doctorId = (token as { doctor_id: string | null } | null)?.doctor_id;
      if (!doctorId) return;
      const { weekday } = istNow();
      const [doctor, schedules] = await Promise.all([
        supabase.from("doctors").select("name").eq("id", doctorId).maybeSingle(),
        supabase.from("doctor_schedules").select("start_time, end_time").eq("doctor_id", doctorId).eq("weekday", weekday),
      ]);
      if (cancelled || !doctor.data) return;
      setInfo({ name: (doctor.data as { name: string }).name, shifts: (schedules.data ?? []) as { start_time: string; end_time: string }[] });
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  useEffect(() => {
    if (!info) return;
    const check = () => {
      const g = shiftGate(info.shifts, istNow().minutes);
      setGate(g ? { ...g, doctorName: info.name } : null);
    };
    const id = setInterval(check, 30_000);
    check();
    return () => clearInterval(id);
  }, [info]);

  return gate;
}
