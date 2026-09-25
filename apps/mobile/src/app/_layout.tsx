import { Poppins_400Regular, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import { Slot } from 'expo-router';

import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/lib/use-session';

export default function RootLayout() {
  const { loading } = useSession();
  const [fontsLoaded] = useFonts({ Poppins_400Regular, Poppins_700Bold });

  if (loading || !fontsLoaded) {
    return <ThemedView style={{ flex: 1 }} />;
  }

  return <Slot />;
}
