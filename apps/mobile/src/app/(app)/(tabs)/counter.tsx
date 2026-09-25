import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Stub — replaced by the real Counter screen (pick counter, call next, serving lifecycle,
// recall, verify priority, realtime queue list) in the same session, kept here only so the
// `counter` tab route exists and the role-routing commit doesn't ship a 404.
export default function Counter() {
  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ThemedText type="body" themeColor="inkMuted">
            Loading counter…
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
