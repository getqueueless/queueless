import type { SymbolViewProps } from 'expo-symbols';
import { Platform, type ViewStyle } from 'react-native';

import { Fonts } from '@/constants/theme';

/** Every tap target in the kit is at least this tall and wide (pt). */
export const MIN_TAP = 48;

export const Radius = { sm: 12, md: 16, lg: 20, pill: 999 } as const;

/**
 * The redesign's type scale: body 17, secondary 15 (the floor: nothing in the kit is smaller),
 * titles 22 / 28 / 34. Poppins 400/700, the only weights the app loads.
 */
export const Type = {
  title1: { fontFamily: Fonts?.poppinsBold, fontSize: 34, lineHeight: 40 },
  title2: { fontFamily: Fonts?.poppinsBold, fontSize: 28, lineHeight: 34 },
  title3: { fontFamily: Fonts?.poppinsBold, fontSize: 22, lineHeight: 28 },
  body: { fontFamily: Fonts?.poppinsRegular, fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontFamily: Fonts?.poppinsBold, fontSize: 17, lineHeight: 24 },
  secondary: { fontFamily: Fonts?.poppinsRegular, fontSize: 15, lineHeight: 20 },
  secondaryStrong: { fontFamily: Fonts?.poppinsBold, fontSize: 15, lineHeight: 20 },
} as const;

export type TypeVariant = keyof typeof Type;

/** SF Symbol on iOS, Material Symbol on Android and web (expo-symbols). */
export type IconName = SymbolViewProps['name'];

/**
 * Warm department accents over the MedWin teal base, as two gradient stops per scheme. Tile text
 * is always `ink`, which clears 10:1 on every light stop and every dark stop; `icon` is the
 * glyph colour on the tile's icon disc (3:1+ as a graphic).
 */
export const Tones = {
  teal: {
    light: { from: '#E0F7FB', to: '#B8ECF5', icon: '#087589' },
    dark: { from: '#0F2E33', to: '#12424A', icon: '#5FDCF3' },
  },
  orange: {
    light: { from: '#FFF0E5', to: '#FFD6B8', icon: '#B4501A' },
    dark: { from: '#3A2014', to: '#50301C', icon: '#FFA071' },
  },
  rose: {
    light: { from: '#FFEAF0', to: '#FFC9D6', icon: '#B42A4E' },
    dark: { from: '#3A1520', to: '#52202F', icon: '#FF8FAB' },
  },
  amber: {
    light: { from: '#FFF7DE', to: '#FFE49A', icon: '#8A5A00' },
    dark: { from: '#33280D', to: '#4A3A12', icon: '#F5C04E' },
  },
  green: {
    light: { from: '#E7F8ED', to: '#BFEBCF', icon: '#1E7A45' },
    dark: { from: '#12291C', to: '#1A3C28', icon: '#6FD69B' },
  },
  blue: {
    light: { from: '#E8F1FF', to: '#C6DAFF', icon: '#2456B8' },
    dark: { from: '#132038', to: '#1C2F52', icon: '#8DB4FF' },
  },
} as const;

export type Tone = keyof typeof Tones;
const TONE_ORDER = Object.keys(Tones) as Tone[];

const DEPARTMENT_TONES: [RegExp, Tone][] = [
  [/general|opd|medicine/i, 'teal'],
  [/ortho|bone|physio/i, 'amber'],
  [/pharm/i, 'green'],
  [/pediatric|paediatric|child/i, 'rose'],
  [/cardio|heart/i, 'orange'],
  [/ent|ear|eye|ophthal|dental/i, 'blue'],
  [/gyn|obst|matern/i, 'orange'],
];

/** A stable tone for a department: known names by keyword, anything else by a name hash. */
export function toneFor(name: string): Tone {
  const hit = DEPARTMENT_TONES.find(([re]) => re.test(name));
  if (hit) return hit[1];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TONE_ORDER[Math.abs(h) % TONE_ORDER.length];
}

const DEPARTMENT_ICONS: [RegExp, IconName][] = [
  [/ortho|bone|physio/i, { ios: 'figure.walk', android: 'accessibility_new', web: 'accessibility_new' }],
  [/pharm/i, { ios: 'pills', android: 'medication', web: 'medication' }],
  [/pediatric|paediatric|child/i, { ios: 'figure.and.child.holdinghands', android: 'child_care', web: 'child_care' }],
  [/cardio|heart/i, { ios: 'heart', android: 'favorite', web: 'favorite' }],
  [/eye|ophthal/i, { ios: 'eye', android: 'visibility', web: 'visibility' }],
  [/ent|ear/i, { ios: 'ear', android: 'hearing', web: 'hearing' }],
  [/lab|path/i, { ios: 'testtube.2', android: 'science', web: 'science' }],
];
const DEFAULT_ICON: IconName = { ios: 'stethoscope', android: 'stethoscope', web: 'stethoscope' };

export function iconFor(name: string): IconName {
  return DEPARTMENT_ICONS.find(([re]) => re.test(name))?.[1] ?? DEFAULT_ICON;
}

/**
 * A CSS linear-gradient as a style: React Native draws it natively (new architecture) and
 * react-native-web passes it through as CSS. No gradient dependency.
 */
export function cssGradient(css: string): ViewStyle {
  return Platform.OS === 'web' ? ({ backgroundImage: css } as ViewStyle) : { experimental_backgroundImage: css };
}

/** Two-stop diagonal gradient; `from` doubles as the solid fallback. */
export function gradient(from: string, to: string): ViewStyle {
  return { backgroundColor: from, ...cssGradient(`linear-gradient(135deg, ${from}, ${to})`) };
}
