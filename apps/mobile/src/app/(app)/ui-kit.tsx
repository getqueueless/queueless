// Hidden dev screen: every component in '@/components/ui', in both themes (flip the toggle).
// Not linked from anywhere; open /ui-kit.
import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemeToggle } from '@/components/ThemeToggle';
import { ThemedView } from '@/components/themed-view';
import { Button, UIText } from '@/components/ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <UIText variant="secondaryStrong" color="inkSecondary">
        {title}
      </UIText>
      {children}
    </View>
  );
}

export default function UiKit() {
  const [loading, setLoading] = useState(false);

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: 'UI kit' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <UIText variant="title1">UI kit</UIText>
          <ThemeToggle />
        </View>

        <Section title="Type">
          <UIText variant="title1">Title 34</UIText>
          <UIText variant="title2">Title 28</UIText>
          <UIText variant="title3">Title 22</UIText>
          <UIText>Body 17 — your token is confirmed.</UIText>
          <UIText variant="secondary">Secondary 15 — the smallest size in the kit.</UIText>
        </Section>

        <Section title="Button">
          <Button
            label="Book & pay ₹300"
            block
            loading={loading}
            onPress={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          />
          <View style={styles.wrap}>
            <Button label="Primary" size="md" />
            <Button label="Secondary" size="md" variant="secondary" />
            <Button label="Ghost" size="md" variant="ghost" />
            <Button label="Cancel token" size="md" variant="danger" />
          </View>
          <View style={styles.wrap}>
            <Button label="Directions" variant="secondary" icon={{ ios: 'map', android: 'map', web: 'map' }} />
            <Button label="Disabled" disabled />
          </View>
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 32, paddingBottom: 160 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
