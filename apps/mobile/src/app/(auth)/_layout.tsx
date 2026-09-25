import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/lib/use-session';

export default function AuthLayout() {
  const { session, loading } = useSession();

  if (loading) return null;
  if (session) return <Redirect href="/(app)/(tabs)" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
