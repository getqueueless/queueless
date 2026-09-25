import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type ProfileStatus = { complete: boolean; loading: boolean };

/**
 * Reads `profiles.profile_completed_at` for the signed-in user — the real gate
 * `complete_my_profile`/`issue_token`/`book_appointment`/`claim_offline_token` all enforce
 * server-side (see supabase/migrations/0037_mandatory_profile.sql). This hook is only the
 * client-side UX shortcut so a screen can redirect before even trying the RPC; the server check
 * is the actual boundary.
 */
export function useProfileStatus(userId: string | undefined): ProfileStatus {
  const [state, setState] = useState<ProfileStatus>({ complete: false, loading: true });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    supabase
      .from('profiles')
      .select('profile_completed_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setState({ complete: !error && !!data?.profile_completed_at, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return { complete: false, loading: false };
  return state;
}
