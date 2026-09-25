import { Slot } from 'expo-router';

import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/lib/use-session';

export default function RootLayout() {
  const { loading } = useSession();

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }

  return <Slot />;
}
