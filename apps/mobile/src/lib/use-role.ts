import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type Role = 'patient' | 'staff' | 'admin';

type RoleState = {
  role: Role;
  orgId: string | null;
  loading: boolean;
};

const DEFAULT_STATE: RoleState = { role: 'patient', orgId: null, loading: true };

/**
 * Reads the signed-in user's own `role`/`org_id` off `profiles` — this is a UI-routing
 * convenience only, never an authorization boundary. Every real staff/admin action still goes
 * through an RPC (`call_next`, `set_member_role`, ...) or an RLS-scoped table write, each of
 * which re-checks the caller's role server-side independently of whatever this hook returns.
 *
 * Defaults to 'patient' while loading and on any read failure — never guesses a privileged
 * role. `profiles` RLS for a plain owner-scoped select is still catching up in places (see
 * docs/DECISIONS.md); a failed read here should never be the reason someone sees staff/admin UI.
 */
export function useRole(userId: string | undefined): RoleState {
  const [state, setState] = useState<RoleState>(DEFAULT_STATE);

  useEffect(() => {
    if (!userId) {
      setState({ role: 'patient', orgId: null, loading: false });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    supabase
      .from('profiles')
      .select('role, org_id')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setState({ role: 'patient', orgId: null, loading: false });
          return;
        }
        setState({ role: (data.role as Role) ?? 'patient', orgId: data.org_id, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}
