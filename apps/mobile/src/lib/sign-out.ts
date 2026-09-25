import { mapAuthError } from '@/lib/errors';
import { unregisterPushTokenAsync } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

/**
 * Shared by Settings and the staff/admin SignOutButton. Returns a user-facing error, or null.
 * No redirect here: (app)/_layout.tsx watches the session and sends a null one to (auth).
 */
export async function signOut(): Promise<string | null> {
  // Before signOut: once signed out, RLS can't see the row and the delete would match 0 rows.
  await unregisterPushTokenAsync();
  // Local scope: sign out this device only, matching the push cleanup above. The default
  // ('global') would sign out the user's other devices while their push rows lived on.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  return error ? mapAuthError({ code: error.code, message: error.message }) : null;
}
