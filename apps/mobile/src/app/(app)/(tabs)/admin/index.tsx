import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Stub — replaced by the real admin dashboard (queue per service, avg wait, no-show rate,
// tokens/hour, peak-hour chart) later in this session.
export default function AdminDashboard() {
  return (
    <ThemedView type="canvas" style={styles.container}>
      <View style={styles.center}>
        <ThemedText type="body" themeColor="inkMuted">
          Loading dashboard…
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
