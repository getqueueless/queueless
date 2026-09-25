import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

export default function TabsLayout() {
  // useTheme follows the in-app Appearance choice. The selected label is text, so it takes the
  // AA text cyan, not `primary` (2.40:1 on white).
  const colors = useTheme();
  const { session } = useSession();
  const { role, loading: roleLoading } = useRole(session?.user?.id);

  // Same tab bar for every role — patient tabs, a Counter tab for staff/admin, an Admin tab for
  // admin only — rather than three parallel route-group trees, so session/chrome logic isn't
  // tripled. `role` is a routing convenience only (see use-role.ts); it is never what actually
  // authorizes a staff/admin action. Gate on role loading so the bar doesn't flash patient tabs
  // for a staff/admin account before the read resolves.
  if (roleLoading) return null;

  return (
    <NativeTabs
      backgroundColor={colors.surface}
      tintColor={colors.primaryText}
      iconColor={colors.inkMuted}
      indicatorColor={colors.primarySoft}>
      {role === 'patient' && (
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {role === 'patient' && (
        <NativeTabs.Trigger name="appointments">
          <NativeTabs.Trigger.Label>Appointments</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {role === 'patient' && (
        <NativeTabs.Trigger name="history">
          <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {(role === 'staff' || role === 'admin') && (
        <NativeTabs.Trigger name="counter">
          <NativeTabs.Trigger.Label>Counter</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {role === 'admin' && (
        <NativeTabs.Trigger name="admin">
          <NativeTabs.Trigger.Label>Admin</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
