import { Stack } from 'expo-router';

import { SignOutButton } from '@/components/sign-out-button';
import { useTheme } from '@/hooks/use-theme';

// The Admin tab is itself a small stack (dashboard, services, counters, staff, priority, AI
// panels) rather than one screen — admin has real CRUD surface area, not a single view.
export default function AdminLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.ink,
        headerShadowVisible: false,
        headerRight: () => <SignOutButton />,
      }}>
      <Stack.Screen name="index" options={{ title: 'Admin' }} />
      <Stack.Screen name="services" options={{ title: 'Services' }} />
      <Stack.Screen name="counters" options={{ title: 'Counters' }} />
      <Stack.Screen name="staff" options={{ title: 'Staff' }} />
      <Stack.Screen name="priority" options={{ title: 'Priority settings' }} />
      <Stack.Screen name="ai" options={{ title: 'Ask your data' }} />
    </Stack>
  );
}
