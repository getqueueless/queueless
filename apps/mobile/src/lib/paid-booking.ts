// Two building blocks for the paid-booking flow: mint a hold (start_paid_booking /
// start_paid_appointment, supabase/migrations/0052/0057), then, separately, hand off to the real
// web payment page in an in-app browser -- the checkout review screen
// (app/(app)/checkout/[holdId].tsx) sits between the two, so minting and paying are no longer one
// call. openPaymentHandoff follows docs/PAYMENTS.md's mobile handoff contract exactly: the
// patient's access token goes in the URL FRAGMENT (never a query string, so it never reaches a
// server log or a Referer header), and the page redirects back to queueless://paid/<holdId> once
// the payment is confirmed.

import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://lpu.lol';

export type StartHoldResult = { ok: true; tokenId: string } | { ok: false; error: string };

export async function startPaidBooking(doctorId: string): Promise<StartHoldResult> {
  const { data, error } = await supabase.rpc('start_paid_booking', { p_doctor_id: doctorId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, tokenId: data.id };
}

export type StartAppointmentHoldResult = { ok: true; holdId: string } | { ok: false; error: string };

export async function startPaidAppointment(slotId: string): Promise<StartAppointmentHoldResult> {
  const { data, error } = await supabase.rpc('start_paid_appointment', { p_slot: slotId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, holdId: data.id };
}

export async function openPaymentHandoff(holdId: string): Promise<{ paid: boolean }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return { paid: false };

  const payUrl = `${WEB_BASE_URL}/pay/${holdId}#access_token=${encodeURIComponent(accessToken)}`;
  const result = await WebBrowser.openAuthSessionAsync(payUrl, 'queueless://paid');

  // Dismissed, cancelled, or backgrounded -- the hold may still be live (10-minute window), so
  // this is not an error; the caller re-checks the hold's own status either way.
  return { paid: result.type === 'success' && 'url' in result && result.url.startsWith('queueless://paid/') };
}
