import { useSyncExternalStore } from 'react';

import { getElderlyMode, subscribeElderlyMode } from '@/lib/elderly-mode-preference';

export function useElderlyMode(): boolean {
  return useSyncExternalStore(subscribeElderlyMode, getElderlyMode, () => false);
}
