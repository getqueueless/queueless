import type { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase';

/**
 * Where to land once a session exists. Same decision for every sign-in method: a patient with
 * no name yet goes to the profile form; everyone else (including staff/admin, who have no name
 * in prod and never need the patient form) goes to their tabs, where the role picks the tabs.
 */
export async function routeAfterAuth(router: ReturnType<typeof useRouter>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (userId) {
    const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', userId).maybeSingle();
    if (profile?.role === 'patient' && !profile.full_name) {
      router.replace('/(app)/name-entry');
      return;
    }
  }
  router.replace('/(app)/(tabs)');
}
