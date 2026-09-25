import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Radius, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { checkForAndroidUpdate, fetchAndroidUpdate, type AndroidUpdate } from '@/lib/app-version';

const DISMISSED_KEY = 'queueless-update-dismissed';
const CHECK_EVERY_MS = 10 * 60 * 1000;

// One sheet, several triggers (mount, foreground, the version row's button): a module-level store.
// `update` outlives `open` so the sheet keeps its content while it slides out.
type SheetState = { update: AndroidUpdate | null; open: boolean };
let state: SheetState = { update: null, open: false };
let lastCheck = 0;
const listeners = new Set<() => void>();

function setState(next: SheetState) {
  state = next;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getState = () => state;
const close = () => setState({ ...state, open: false });

function isDismissed(versionCode: number): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === String(versionCode);
  } catch {
    return false;
  }
}

function dismiss(versionCode: number) {
  try {
    localStorage.setItem(DISMISSED_KEY, String(versionCode));
  } catch {
    // Non-fatal: it just asks again next launch.
  }
  close();
}

async function autoCheck() {
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  const update = await checkForAndroidUpdate();
  if (update && !isDismissed(update.versionCode)) setState({ update, open: true });
}

/** A manual check: opens the sheet when there's an update, even one the user said "Later" to. */
export async function requestUpdateCheck(): Promise<'update' | 'none' | 'error'> {
  try {
    lastCheck = Date.now();
    const update = await fetchAndroidUpdate();
    if (!update) return 'none';
    setState({ update, open: true });
    return 'update';
  } catch {
    return 'error';
  }
}

/** Android sideload updates: checks lpu.lol on launch and on foreground, then offers the APK. */
export function AndroidUpdateSheet() {
  return Platform.OS === 'android' ? <Sheet /> : null;
}

function Sheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { update, open } = useSyncExternalStore(subscribe, getState, getState);

  useEffect(() => {
    autoCheck();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') autoCheck();
    });
    return () => sub.remove();
  }, []);

  if (!update) return null;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 16 }]}>
          <UIText variant="title3" accessibilityRole="header">
            Update available {update.versionName}
          </UIText>
          {update.notes ? <UIText variant="secondary">{update.notes}</UIText> : null}
          <Button
            label="Update"
            size="lg"
            block
            style={styles.primary}
            onPress={() => {
              // Android downloads the APK and installs it over this app.
              Linking.openURL(update.apk).catch(() => {});
              close();
            }}
          />
          <Button label="Later" variant="ghost" size="lg" block onPress={() => dismiss(update.versionCode)} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingTop: 24,
    paddingHorizontal: 16,
    gap: 12,
  },
  primary: { marginTop: 8 },
});
