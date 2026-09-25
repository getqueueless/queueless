import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase';

/**
 * Where GoTrue sends the user back after Google, an emailed sign-in link, or a password-reset
 * link: queueless://auth/callback in a native build, exp://…/--/auth/callback in Expo Go. Both
 * match GoTrue's allow-list (queueless://**, exp://**). src/app/auth/callback.tsx handles it.
 */
export const AUTH_REDIRECT = Linking.createURL('auth/callback');

export type ExchangeResult = { ok: true; recovery: boolean } | { ok: false; message: string };

type Params = Record<string, string | string[] | undefined | null>;

function pick(params: Params, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value ? value : undefined;
}

// A code can only be exchanged once, but two callers can hold the same one: a dev double-mount
// of auth/callback, or Android handing the Google redirect to both the auth session and the
// router. Everyone asking about the same code shares the first exchange's result.
const exchanges = new Map<string, Promise<ExchangeResult>>();

async function exchange(code: string, flowId: string | undefined): Promise<ExchangeResult> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  // Raw PKCE errors are developer text (they mention @supabase/ssr); users get one plain line.
  if (error) return { ok: false, message: 'That link didn’t work on this phone. Request a new one from the app.' };
  // supabase-js returns redirectType ('recovery' for a password-reset link) at runtime but its
  // published type for this call omits it.
  const redirectType = (data as { redirectType?: string | null }).redirectType;
  return { ok: true, recovery: redirectType === 'recovery' };
}

/**
 * Finishes a PKCE redirect: swaps the `code` query param for a session. supabase-js may append
 * its own `sb_flow_id` to the redirect; passing it back picks the matching code verifier.
 */
export function exchangeAuthRedirect(params: Params): Promise<ExchangeResult> {
  const code = pick(params, 'code');
  if (!code) {
    return Promise.resolve({
      ok: false,
      message: pick(params, 'error_description') ?? 'That link didn’t work. Request a new one.',
    });
  }
  let pending = exchanges.get(code);
  if (!pending) {
    pending = exchange(code, pick(params, 'sb_flow_id'));
    exchanges.set(code, pending);
  }
  return pending;
}
