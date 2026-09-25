import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useProfileStatus } from '@/lib/use-profile-status';
import { useSession } from '@/lib/use-session';

/**
 * Client-side gate for take-token/book/claim screens: bounces to the profile-completion screen
 * before the patient can even open the picker, instead of only finding out after `issue_token`/
 * `book_appointment`/`claim_offline_token` reject with `profile_incomplete`. Returns `true` only
 * once the profile is confirmed complete — screens should render nothing (or a spinner) until
 * then, since a redirect may be in flight.
 */
export function useRequireCompleteProfile(): boolean {
  const router = useRouter();
  const { session } = useSession();
  const { complete, loading } = useProfileStatus(session?.user?.id);

  useEffect(() => {
    if (!loading && session && !complete) {
      router.replace('/(app)/name-entry');
    }
  }, [loading, session, complete, router]);

  return !loading && complete;
}
