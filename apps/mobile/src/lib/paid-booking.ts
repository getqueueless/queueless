// Two building blocks for the paid-booking flow: mint a hold (start_paid_booking /
// start_paid_appointment, supabase/migrations/0052/0057), then, separately, hand off to the real
// web payment page in an in-app browser -- the checkout review screen
// (app/(app)/checkout/[holdId].tsx) sits between the two, so minting and paying are no longer one
// call. openPaymentHandoff follows docs/PAYMENTS.md's mobile handoff contract exactly: the
// patient's access token goes in the URL FRAGMENT (never a query string, so it never reaches a
// server log or a Referer header), and the page redirects back to queueless://paid/<holdId> once
// the payment is confirmed.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://lpu.lol';

export type StartHoldResult = { ok: true; tokenId: string } | { ok: false; error: string };

// p_requested_lane/p_note (Hackathon database, confirmed signature): only 'normal' (default),
// 'pregnant', 'emergency' are valid to pass -- 'senior' is server-detected from
// profiles.date_of_birth and ignored/overridden if sent. Both params default server-side, so
// every existing call site with just an id keeps working unchanged.
export async function startPaidBooking(
  doctorId: string,
  requestedLane?: 'normal' | 'pregnant' | 'emergency',
  note?: string | null,
): Promise<StartHoldResult> {
  const { data, error } = await supabase.rpc('start_paid_booking', {
    p_doctor_id: doctorId,
    ...(requestedLane ? { p_requested_lane: requestedLane } : {}),
    ...(note ? { p_note: note } : {}),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, tokenId: data.id };
}

export type StartAppointmentHoldResult = { ok: true; holdId: string } | { ok: false; error: string };

export async function startPaidAppointment(
  slotId: string,
  requestedLane?: 'normal' | 'pregnant' | 'emergency',
  note?: string | null,
): Promise<StartAppointmentHoldResult> {
  const { data, error } = await supabase.rpc('start_paid_appointment', {
    p_slot: slotId,
    ...(requestedLane ? { p_requested_lane: requestedLane } : {}),
    ...(note ? { p_note: note } : {}),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, holdId: data.id };
}

const PAID_DEEP_LINK_PREFIX = 'queueless://paid/';

// openAuthSessionAsync (ASWebAuthenticationSession) crashed on a real iOS device mid-payment:
// it's an ephemeral, single-purpose auth sheet that can't hand off to another app, so Razorpay's
// UPI intents (upi://, gpay://, phonepe://) inside it are a likely failure point, and the OS can
// tear the session down under it on a re-render. openBrowserAsync (SFSafariViewController) can
// hand off to other apps and survives that -- but unlike openAuthSessionAsync, it does NOT close
// itself on the queueless://paid/<holdId> redirect, so a Linking listener has to catch that and
// dismiss it explicitly. The result is read back from the server (the caller re-fetches the
// hold's real status), never trusted from the URL itself -- this return value is best-effort UX
// only, same contract as before.
export async function openPaymentHandoff(holdId: string): Promise<{ paid: boolean }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return { paid: false };

  const payUrl = `${WEB_BASE_URL}/pay/${holdId}#access_token=${encodeURIComponent(accessToken)}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (paid: boolean) => {
      if (settled) return;
      settled = true;
      sub.remove();
      WebBrowser.dismissBrowser();
      resolve({ paid });
    };
    const onUrl = ({ url }: { url: string }) => {
      if (url.startsWith(PAID_DEEP_LINK_PREFIX)) finish(true);
    };
    const sub = Linking.addEventListener('url', onUrl);
    // Cold-start case: the app was launched BY the deep link (backgrounded during checkout),
    // so no 'url' event fires for it -- getInitialURL() catches that once.
    Linking.getInitialURL().then((initial) => {
      if (initial?.startsWith(PAID_DEEP_LINK_PREFIX)) finish(true);
    });
    WebBrowser.openBrowserAsync(payUrl).then((result) => {
      // Fires when the user closes the browser themselves too, not just from our own
      // dismissBrowser() above -- `settled` guards against a duplicate resolve either way.
      if (result.type === 'dismiss') finish(false);
    });
  });
}
