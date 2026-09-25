import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { AUTH_REDIRECT, exchangeAuthRedirect } from '@/lib/auth-redirect';
import { supabase } from '@/lib/supabase';

// Required once at module load so a completed auth session properly closes the browser tab
// and hands control back to the app (no-op on native if there's nothing pending; needed on web).
WebBrowser.maybeCompleteAuthSession();

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
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    return { ok: false, cancelled: false, message: error?.message || "Google sign-in isn't set up yet." };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT);
  if (result.type !== 'success' || !result.url) {
    // 'cancel'/'dismiss' — the user backed out of the browser tab themselves, not a failure.
    return { ok: false, cancelled: true };
  }
  // Shared with auth/callback: on Android the same redirect may also open that screen.
  const exchanged = await exchangeAuthRedirect(Linking.parse(result.url).queryParams ?? {});
  return exchanged.ok ? { ok: true } : { ok: false, cancelled: false, message: exchanged.message };
}
