import type { SupabaseClient } from '@supabase/supabase-js';

export type PushPlatform = 'ios' | 'android' | 'web';

/** Postgres insufficient_privilege: RLS refused the ON CONFLICT update because another account owns the row. */
export const OWNED_BY_ANOTHER_ACCOUNT = '42501';

/**
 * Upserts this device's Expo token under owner-only RLS. `expo_token` is globally unique, so
 * onConflict turns a re-registration into a no-op instead of a 23505. Returns null when saved,
 * otherwise the error code.
 */
export async function savePushToken(
  client: SupabaseClient,
  userId: string,
  token: string,
  platform: PushPlatform,
): Promise<string | null> {
  const { error } = await client
    .from('push_tokens')
    .upsert({ user_id: userId, expo_token: token, platform }, { onConflict: 'expo_token' });
  return error ? error.code || error.message : null;
}

/** Deletes one token's row. Needs a live session: RLS lets only the owner delete it. */
export async function deletePushToken(client: SupabaseClient, token: string): Promise<boolean> {
  const { error } = await client.from('push_tokens').delete().eq('expo_token', token);
  return !error;
}
