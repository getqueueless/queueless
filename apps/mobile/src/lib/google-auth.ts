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
 * REDIRECT_TO is queueless://auth/callback in a native build and exp://…/--/auth/callback in
 * Expo Go — both covered by GoTrue's allow-list (queueless://**, exp://**).
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

  // exchangeCodeForSession takes the bare `code`, not the callback URL. supabase-js may also
  // append its own `sb_flow_id` to redirectTo; pass it back so the right PKCE verifier is used.
  const params = Linking.parse(result.url).queryParams ?? {};
  const code = typeof params.code === 'string' ? params.code : null;
  if (!code) {
    const reason = typeof params.error_description === 'string' ? params.error_description : null;
    return { ok: false, cancelled: false, message: reason || "Couldn't complete Google sign-in." };
  }
  const flowId = typeof params.sb_flow_id === 'string' ? params.sb_flow_id : undefined;
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (exchangeError) {
    return { ok: false, cancelled: false, message: exchangeError.message || "Couldn't complete Google sign-in." };
  }
  return { ok: true };
}
