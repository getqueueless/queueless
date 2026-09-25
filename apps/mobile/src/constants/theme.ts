/**
 * Derived from apps/mobile/DESIGN.md — tokens pulled directly from the MedWin reference
 * template (~/code/design-ref/medwin/). apps/web's MedWin token layer has since landed and owns
 * the AA-checked values these text colors now follow; DESIGN.md maps the names between the two.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    primary: '#0cb7d6',
    primaryOutline: '#2cc1db',
    primarySoft: '#e3f7fa',
    // apps/web/brand/BRAND.md: #0cb7d6 is 2.40:1 on white, so it is never text. Large cyan words
    // use primaryDisplay (3.55:1, large only), small cyan text and links use primaryText (5.36:1),
    // and text on cyan fills is ink (6.39:1), never white.
    primaryDisplay: '#0a95ae',
    primaryText: '#087589',
    dark: '#1a3237',
    onPrimary: '#252525',
    canvas: '#ffffff',
    canvasSoft: '#f7fbfc',
    surface: '#ffffff',
    surfaceSunken: '#f0f4f5',
    ink: '#252525',
    inkSecondary: '#6b6b6b',
    inkMuted: '#666666',
    hairline: '#cfcfcf',
    hairlineStrong: '#a9a9a9',
    success: '#197c53',
    successSoft: '#e3f4ea',
    warning: '#95590a',
    warningSoft: '#faf0dd',
    danger: '#c13b34',
    dangerSoft: '#fbe8e6',
  },
  dark: {
    primary: '#3fd6f0',
    primaryOutline: '#5fdcf3',
    primarySoft: '#123338',
    primaryDisplay: '#3fd6f0',
    primaryText: '#5fdcf3',
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
