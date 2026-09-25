import { Redirect, Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/use-session';

export default function AppLayout() {
  const { session, loading } = useSession();
  const theme = useTheme();

  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.ink,
        headerShadowVisible: false,
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="token/[id]" options={{ title: 'Your ticket' }} />
    </Stack>
  );
}
