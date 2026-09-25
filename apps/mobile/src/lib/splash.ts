import * as SplashScreen from 'expo-splash-screen';

// Keep the native splash up through the cold-start reads (session, fonts, then the user's role)
// instead of flashing an empty screen between them. Imported by the root layout, so this runs
// before the first frame.
SplashScreen.preventAutoHideAsync().catch(() => {});

let hidden = false;

/** Idempotent: whichever screen first knows what to show calls this. */
export function hideSplash() {
  if (hidden) return;
  hidden = true;
  SplashScreen.hide();
}
