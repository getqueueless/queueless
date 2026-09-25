import { useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, UIText } from '@/components/ui';
import { requestUpdateCheck } from '@/components/update-sheet';
import { appVersion } from '@/lib/app-version';

/** "Version 1.0.X (build X)" plus a manual update check on Android. Drop-in for any settings list. */
export function AppVersionRow({ style }: { style?: StyleProp<ViewStyle> }) {
  const { version, build } = appVersion();
  const [status, setStatus] = useState<'idle' | 'checking' | 'none' | 'error'>('idle');

  async function check() {
    setStatus('checking');
    const result = await requestUpdateCheck();
    // An update opens the sheet on its own; only the other outcomes need a line here.
    setStatus(result === 'update' ? 'idle' : result);
  }

  return (
    <View style={[styles.wrap, style]}>
      <UIText variant="secondary">
        Version {version}
        {build !== null ? ` (build ${build})` : ''}
      </UIText>
      {Platform.OS === 'android' ? (
        <>
          <Button
            label="Check for updates"
            variant="secondary"
            size="md"
            loading={status === 'checking'}
            onPress={check}
          />
          {status === 'none' || status === 'error' ? (
            <UIText variant="secondary" color={status === 'error' ? 'danger' : undefined} accessibilityLiveRegion="polite">
              {status === 'none' ? "You're on the latest version." : "Couldn't check right now."}
            </UIText>
          ) : null}
        </>
      ) : Platform.OS === 'ios' ? (
        <UIText variant="secondary">Updates install through SideStore.</UIText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, alignItems: 'flex-start' },
});
