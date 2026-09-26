import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signOut } from '@/lib/sign-out';

// Alert.alert with buttons is a no-op on react-native-web, so web falls back to confirm().
function confirmSignOut(onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm('Sign out of WaitWise?')) onConfirm();
    return;
  }
  Alert.alert('Sign out of WaitWise?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: onConfirm },
  ]);
}

/** Compact sign-out control for staff/admin screens (header right or a toolbar row). */
export function SignOutButton() {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  function handlePress() {
    confirmSignOut(async () => {
      setBusy(true);
      const message = await signOut();
      if (message) {
        setBusy(false);
        if (Platform.OS === 'web') window.alert(message);
        else Alert.alert("Couldn't sign out", message);
      }
    });
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      hitSlop={8}
      style={styles.button}>
      {busy ? (
        <ActivityIndicator color={theme.danger} />
      ) : (
        <ThemedText type="button" themeColor="danger">
          Sign out
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.xs, alignItems: 'center', justifyContent: 'center' },
});
