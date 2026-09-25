/**
 * Derived from apps/mobile/DESIGN.md — tokens pulled directly from the MedWin reference
 * template (~/code/design-ref/medwin/), independently of apps/web/DESIGN.md, which still
 * described the old teal/Inter system when this was written. Reconcile against
 * apps/web/DESIGN.md once its own MedWin pass lands — see docs/DECISIONS.md.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    primary: '#0cb7d6',
    primaryOutline: '#2cc1db',
    primarySoft: '#e3f7fa',
    // apps/web/brand/BRAND.md: #0cb7d6 is 2.40:1 on white, so cyan words use #0a95ae (large
    // text only, 3.55:1) and text on cyan fills is ink (6.39:1), never white.
    primaryDisplay: '#0a95ae',
    dark: '#1a3237',
    onPrimary: '#252525',
    canvas: '#ffffff',
    canvasSoft: '#f7fbfc',
    surface: '#ffffff',
    surfaceSunken: '#f0f4f5',
    ink: '#1f1f1f',
    inkSecondary: '#898989',
    inkMuted: '#666666',
    hairline: '#cfcfcf',
    hairlineStrong: '#a9a9a9',
    success: '#1c8a5c',
    successSoft: '#e3f4ea',
    warning: '#a9660c',
    warningSoft: '#faf0dd',
    danger: '#c23b34',
    dangerSoft: '#fbe8e6',
    focusRing: '#0cb7d6',
  },
  dark: {
    primary: '#3fd6f0',
    primaryOutline: '#5fdcf3',
    primarySoft: '#123338',
    primaryDisplay: '#3fd6f0',
    dark: '#0d1a1d',
    onPrimary: '#04201e',
    canvas: '#0a0c0f',
    canvasSoft: '#0e1518',
    surface: '#14171c',
    surfaceSunken: '#181c21',
    ink: '#eef0f3',
    inkSecondary: '#a9adb3',
    inkMuted: '#7d8290',
    hairline: '#2a2f36',
    hairlineStrong: '#3a4046',
    success: '#4cbf8b',
    successSoft: '#0f2b21',
    warning: '#dba24d',
    warningSoft: '#2e2211',
    danger: '#e5766f',
    dangerSoft: '#301715',
    focusRing: '#3fd6f0',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    mono: 'ui-monospace',
    poppinsRegular: 'Poppins_400Regular',
    poppinsBold: 'Poppins_700Bold',
  },
  default: {
    mono: 'monospace',
    poppinsRegular: 'Poppins_400Regular',
    poppinsBold: 'Poppins_700Bold',
  },
  web: {
    mono: 'var(--font-mono)',
    poppinsRegular: 'Poppins_400Regular',
    poppinsBold: 'Poppins_700Bold',
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

/** MedWin leans on soft, low-offset, blurred shadows (style.css:480, 899) for card lift. */
export const CardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
