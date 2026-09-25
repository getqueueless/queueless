import { ELDERLY_MODE_SCALE } from '@/lib/elderly-mode-preference';
import { useElderlyMode } from '@/hooks/use-elderly-mode';

/** 1.3x when elderly mode is on, 1 otherwise. Multiply an explicit fontSize/lineHeight by this. */
export function useTextScale(): number {
  return useElderlyMode() ? ELDERLY_MODE_SCALE : 1;
}
