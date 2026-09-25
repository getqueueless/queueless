// Entry point for "Book & pay": mints a pending_payment hold (start_paid_booking,
// supabase/migrations/0052) then opens the real web payment page in an in-app browser,
// following docs/PAYMENTS.md's mobile handoff contract exactly -- the patient's access token
// goes in the URL FRAGMENT (never a query string, so it never reaches a server log or a
// Referer header), and the page redirects back to queueless://paid/<tokenId> once the payment
// is confirmed. Import this and call it from one button; it owns no UI itself.

import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://lpu.lol';

export type StartPaidBookingResult =
  | { ok: true; paid: boolean; tokenId: string }
  | { ok: false; error: string };

export async function startPaidBooking(doctorId: string): Promise<StartPaidBookingResult> {
  const { data: token, error: rpcError } = await supabase.rpc('start_paid_booking', { p_doctor_id: doctorId });
  if (rpcError) {
    return { ok: false, error: rpcError.message };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: 'Not signed in.' };
  }

  const payUrl = `${WEB_BASE_URL}/pay/${token.id}#access_token=${encodeURIComponent(accessToken)}`;
  const result = await WebBrowser.openAuthSessionAsync(payUrl, 'queueless://paid');

  if (result.type === 'success' && 'url' in result && result.url.startsWith('queueless://paid/')) {
    return { ok: true, paid: true, tokenId: token.id };
  }
  // Dismissed, cancelled, or backgrounded -- the hold may still be live (10-minute window), so
  // this is not an error. The caller's own token/appointment list already shows a
  // pending_payment ticket either way; nothing here needs to re-poll.
  return { ok: true, paid: false, tokenId: token.id };
}
