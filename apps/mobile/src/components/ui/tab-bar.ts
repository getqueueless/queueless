import type { NativeTabsProps, NativeTabsTriggerIconProps } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

import { Type } from './tokens';

/**
 * Props for the app's NativeTabs bar: a solid surface (no glass, so labels stay AA), Poppins
 * labels at the kit's 15pt floor that go bold when active, always labelled, and Android's
 * active-indicator pill in primarySoft. Spread onto <NativeTabs>.
 */
export function useTabBarStyle() {
  const theme = useTheme();
  return {
    backgroundColor: theme.surface,
    blurEffect: 'none',
    disableTransparentOnScrollEdge: true,
    tintColor: theme.primaryText,
    iconColor: { default: theme.inkMuted, selected: theme.primaryText },
    labelStyle: {
      default: { color: theme.inkMuted, fontFamily: Type.secondary.fontFamily, fontSize: Type.secondary.fontSize },
      selected: { color: theme.primaryText, fontFamily: Type.secondaryStrong.fontFamily, fontSize: Type.secondary.fontSize },
    },
    indicatorColor: theme.primarySoft,
    labelVisibilityMode: 'labeled',
  } satisfies Partial<NativeTabsProps>;
}

/** Outline icons that fill in when their tab is active (SF Symbols on iOS, Material on Android). */
export const TAB_ICONS = {
  index: { sf: { default: 'house', selected: 'house.fill' }, md: 'home' },
  appointments: { sf: { default: 'calendar', selected: 'calendar.circle.fill' }, md: 'calendar_month' },
  history: { sf: { default: 'clock.arrow.circlepath', selected: 'clock.fill' }, md: 'history' },
  counter: { sf: { default: 'person.wave.2', selected: 'person.wave.2.fill' }, md: 'support_agent' },
  admin: { sf: { default: 'chart.bar', selected: 'chart.bar.fill' }, md: 'admin_panel_settings' },
  settings: { sf: { default: 'gearshape', selected: 'gearshape.fill' }, md: 'settings' },
  // Patient redesign's four tabs -- added per Hackathon mobile app's request, names checked
  // against sf-symbols-typescript and expo-symbols' AndroidSymbol union.
  doctors: { sf: { default: 'stethoscope', selected: 'stethoscope' }, md: 'stethoscope' },
  'my-tokens': { sf: { default: 'ticket', selected: 'ticket.fill' }, md: 'confirmation_number' },
  profile: { sf: { default: 'person.crop.circle', selected: 'person.crop.circle.fill' }, md: 'account_circle' },
} satisfies Record<string, NativeTabsTriggerIconProps>;
