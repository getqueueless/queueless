import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';

// DB-side broadcast (docs/API_CONTRACT.md "Realtime topics", migration 0044): every tokens
// insert/update sends `token_update` on `service:<service_id>`. postgres_changes never fires on
// this stack (empty publication), so this is the only push signal for a queue.
//
// realtime-js hands back the SAME channel for a topic already in use, so two screens (Counter
// and the admin dashboard are both mounted as tabs) must share one channel per topic. This
// keeps one channel per service and fans each broadcast out to every listener.
const listeners = new Map<string, Set<() => void>>();

function listen(serviceId: string, onUpdate: () => void): () => void {
  let set = listeners.get(serviceId);
  if (!set) {
    const fresh = new Set<() => void>();
    listeners.set(serviceId, fresh);
    supabase
      .channel(`service:${serviceId}`)
      .on('broadcast', { event: 'token_update' }, () => fresh.forEach((fn) => fn()))
      .subscribe();
    set = fresh;
  }
  const own = set;
  own.add(onUpdate);
  return () => {
    own.delete(onUpdate);
    if (own.size > 0 || listeners.get(serviceId) !== own) return;
    listeners.delete(serviceId);
    const channel = supabase.getChannels().find((c) => c.topic === `realtime:service:${serviceId}`);
    if (channel) supabase.removeChannel(channel);
  };
}

/** Calls `onUpdate` (keep it stable) whenever a token in any of these services changes. */
export function useServiceUpdates(serviceIds: string[], onUpdate: () => void) {
  const key = [...serviceIds].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const stops = key.split(',').map((id) => listen(id, onUpdate));
    return () => stops.forEach((stop) => stop());
  }, [key, onUpdate]);
}
