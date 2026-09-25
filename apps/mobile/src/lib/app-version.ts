import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type AndroidUpdate = { versionCode: number; versionName: string; apk: string; notes?: string };

const VERSION_URL = 'https://lpu.lol/android/version.json';

/** The shipped version (CI writes expo.version = 1.0.<run> and the build = <run> before prebuild). */
export function appVersion(): { version: string; build: number | null } {
  const config = Constants.expoConfig;
  const raw =
    Platform.OS === 'android' ? config?.android?.versionCode : Platform.OS === 'ios' ? config?.ios?.buildNumber : undefined;
  const build = Number(raw);
  return { version: config?.version ?? 'unknown', build: Number.isInteger(build) && build > 0 ? build : null };
}

/**
 * The published APK if it is newer than this install; null when it isn't, off Android, or when
 * the installed build is unknown (dev). Throws on network or shape errors so a manual check can
 * tell "none" from "error"; everything else should call checkForAndroidUpdate.
 */
export async function fetchAndroidUpdate(): Promise<AndroidUpdate | null> {
  if (Platform.OS !== 'android') return null;
  const installed = appVersion().build;
  if (installed === null) return null;
  const res = await fetch(VERSION_URL, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`version.json: HTTP ${res.status}`);
  const { versionCode, versionName, apk, notes } = ((await res.json()) ?? {}) as Record<string, unknown>;
  // `{}` (nothing published yet) or no versionCode means there's nothing newer: up to date.
  if (!Number.isInteger(versionCode)) return null;
  if (typeof apk !== 'string' || !apk.startsWith('https://')) {
    throw new Error('version.json: unexpected apk');
  }
  const code = versionCode as number;
  if (code <= installed) return null;
  return {
    versionCode: code,
    versionName: typeof versionName === 'string' && versionName ? versionName : `1.0.${code}`,
    apk,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
  };
}

/** Never throws: null on any error. */
export function checkForAndroidUpdate(): Promise<AndroidUpdate | null> {
  return fetchAndroidUpdate().catch(() => null);
}
