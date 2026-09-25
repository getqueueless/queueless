import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

// Required once at module load so a completed auth session properly closes the browser tab
// and hands control back to the app (no-op on native if there's nothing pending; needed on web).
WebBrowser.maybeCompleteAuthSession();

const REDIRECT_TO = Linking.createURL('auth/callback');

export type GoogleSignInResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

/**
 * PKCE, server-mediated OAuth (the pattern Supabase's own Expo/React Native guide documents):
 * get the provider's auth URL from GoTrue with `skipBrowserRedirect` (supabase-js would
 * otherwise try `window.location`, which doesn't exist in React Native), open it in a real
 * browser tab via expo-web-browser so Google's own cookies/2FA/passkey flows work exactly as
 * they would in any browser, then exchange the code GoTrue redirects back with for a session.
 *
 * The server side of this (a Google Cloud OAuth client, and GOTRUE_EXTERNAL_GOOGLE_* env vars
 * on the deployed stack) is not configured yet as of this build — see docs/DECISIONS.md. Until
 * it is, GoTrue rejects the request and this surfaces as a normal mapped error, not a crash.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    return { ok: false, cancelled: false, message: error?.message || "Google sign-in isn't set up yet." };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
  if (result.type !== 'success' || !result.url) {
    // 'cancel'/'dismiss' — the user backed out of the browser tab themselves, not a failure.
    return { ok: false, cancelled: true };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.url);
  if (exchangeError) {
    return { ok: false, cancelled: false, message: exchangeError.message || "Couldn't complete Google sign-in." };
  }
  return { ok: true };
}
