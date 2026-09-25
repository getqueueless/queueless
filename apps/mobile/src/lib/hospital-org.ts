import { supabase } from '@/lib/supabase';

// The org whose departments and doctors a patient sees. Mirrors apps/web's /my loadOrg: the
// user's own org when the profile has one, otherwise the OLDEST organization -- the hospital,
// not an org a load test added later. Without this, every org's open services show up.
// ponytail: cached per signed-in user for the app run; a real multi-hospital app would pick the
// org explicitly.
let cache: { userId: string | null; org: Promise<string | null> } | null = null;

async function load(userId: string | null): Promise<string | null> {
  if (userId) {
    const { data } = await supabase.from('profiles').select('org_id').eq('id', userId).maybeSingle();
    const own = (data as { org_id: string | null } | null)?.org_id;
    if (own) return own;
  }
  const { data } = await supabase.from('organizations').select('id').order('created_at').limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function hospitalOrgId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id ?? null;
  if (!cache || cache.userId !== userId) cache = { userId, org: load(userId) };
  return cache.org;
}
