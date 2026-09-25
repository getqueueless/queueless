import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Stub — replaced by the real Services screen later in this session.
export default function AdminServices() {
  return (
    <ThemedView type="canvas" style={styles.container}>
      <View style={styles.center}>
        <ThemedText type="body" themeColor="inkMuted">
          Loading…
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
