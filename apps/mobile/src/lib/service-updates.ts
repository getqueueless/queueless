import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';

// DB-side broadcast (docs/API_CONTRACT.md "Realtime topics", migration 0044): every tokens
// insert/update sends `token_update` on `service:<service_id>`. postgres_changes never fires on
// this stack (empty publication), so this is the only push signal for a queue.
//
// realtime-js hands back the SAME channel for a topic already in use, so two screens (Counter
// and the admin dashboard are both mounted as tabs) must share one channel per topic. This
// keeps one channel per service and fans each broadcast out to every listener.
//
// A channel that is still leaving is also handed back (and its subscribe() is a no-op), so a
// quick leave + rejoin of the same topic (switching desks and back) must wait for the leave.
type Entry = { listeners: Set<() => void>; channel: RealtimeChannel | null };
const entries = new Map<string, Entry>();
const leaving = new Map<string, Promise<unknown>>();

function listen(serviceId: string, onUpdate: () => void): () => void {
  let entry = entries.get(serviceId);
  if (!entry) {
    const fresh: Entry = { listeners: new Set(), channel: null };
    entries.set(serviceId, fresh);
    (leaving.get(serviceId) ?? Promise.resolve()).then(() => {
      if (entries.get(serviceId) !== fresh) return; // everyone left before the old channel did
      fresh.channel = supabase
        .channel(`service:${serviceId}`)
        .on('broadcast', { event: 'token_update' }, () => fresh.listeners.forEach((fn) => fn()))
        .subscribe();
    });
    entry = fresh;
  }
  const own = entry;
  own.listeners.add(onUpdate);
  return () => {
    own.listeners.delete(onUpdate);
    if (own.listeners.size > 0 || entries.get(serviceId) !== own) return;
    entries.delete(serviceId);
    if (!own.channel) return;
    const removal = supabase.removeChannel(own.channel).finally(() => {
      if (leaving.get(serviceId) === removal) leaving.delete(serviceId);
    });
    leaving.set(serviceId, removal);
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
