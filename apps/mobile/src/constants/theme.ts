/**
 * Ported from apps/web/DESIGN.md — the shared Queueless design system. Keep values in sync
 * with that file; it is the source of truth, this is the React Native rendering of it.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    primary: '#1f6f74',
    primaryHover: '#175a5e',
    primaryPress: '#124749',
    primarySoft: '#e3f1f1',
    onPrimary: '#ffffff',
    canvas: '#ffffff',
    canvasSoft: '#f6f7f9',
    surface: '#ffffff',
    surfaceSunken: '#eef0f3',
    ink: '#14171c',
    inkSecondary: '#4a4f5a',
    inkMuted: '#7a808d',
    hairline: '#e3e6eb',
    hairlineStrong: '#cdd2da',
    success: '#1c8a5c',
    successSoft: '#e3f4ea',
    warning: '#a9660c',
    warningSoft: '#faf0dd',
    danger: '#c23b34',
    dangerSoft: '#fbe8e6',
    focusRing: '#1f6f74',
  },
  dark: {
    primary: '#4fb8ae',
    primaryHover: '#6cc7bd',
    primaryPress: '#3d9a91',
    primarySoft: '#123331',
    onPrimary: '#04201e',
    canvas: '#0a0c0f',
    canvasSoft: '#101317',
    surface: '#14171c',
    surfaceSunken: '#0e1114',
    ink: '#eef0f3',
    inkSecondary: '#b7bcc6',
    inkMuted: '#7d8290',
    hairline: '#24282f',
    hairlineStrong: '#343941',
    success: '#4cbf8b',
    successSoft: '#0f2b21',
    warning: '#dba24d',
    warningSoft: '#2e2211',
    danger: '#e5766f',
    dangerSoft: '#301715',
    focusRing: '#4fb8ae',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  section: 64,
} as const;

export const Rounded = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
