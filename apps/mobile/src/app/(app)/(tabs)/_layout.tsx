import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { hideSplash } from '@/lib/splash';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

export default function TabsLayout() {
  // useTheme follows the in-app Appearance choice. The selected label is text, so it takes the
  // AA text cyan, not `primary` (2.40:1 on white).
  const colors = useTheme();
  const { session } = useSession();
  const { role, loading: roleLoading } = useRole(session?.user?.id);

  useEffect(() => {
    if (!roleLoading) hideSplash();
  }, [roleLoading]);

  // Same tab bar for every role — patient tabs, a Counter tab for staff/admin, an Admin tab for
  // admin only — rather than three parallel route-group trees, so session/chrome logic isn't
  // tripled. `role` is a routing convenience only (see use-role.ts); it is never what actually
  // authorizes a staff/admin action. Gate on role loading so the bar doesn't flash patient tabs
  // for a staff/admin account before the read resolves. On native the splash is still up while
  // this spinner renders; on web it's what shows instead of a blank page.
  if (roleLoading) {
    return (
      <ThemedView type="canvas" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </ThemedView>
    );
  }

  // Contrast: on the translucent iOS glass the cyan label measured 4.27:1 (light) and the muted
  // label 3.63:1 (dark), under AA. A solid surface bar with no blur gives 5.36/5.74:1 (light) and
  // 11.1/4.68:1 (dark) for selected/unselected.
  return (
    <NativeTabs
      backgroundColor={colors.surface}
      blurEffect="none"
      disableTransparentOnScrollEdge
      tintColor={colors.primaryText}
      iconColor={{ default: colors.inkMuted, selected: colors.primaryText }}
      labelStyle={{ default: { color: colors.inkMuted }, selected: { color: colors.primaryText } }}
      indicatorColor={colors.primarySoft}>
      {role === 'patient' && (
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {role === 'patient' && (
        <NativeTabs.Trigger name="appointments">
          <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
          <NativeTabs.Trigger.Label>Appointments</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {role === 'patient' && (
        <NativeTabs.Trigger name="history">
          <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" md="history" />
          <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {(role === 'staff' || role === 'admin') && (
        <NativeTabs.Trigger name="counter">
          <NativeTabs.Trigger.Icon sf="person.wave.2.fill" md="support_agent" />
          <NativeTabs.Trigger.Label>Counter</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {role === 'admin' && (
        <NativeTabs.Trigger name="admin">
          <NativeTabs.Trigger.Icon sf="chart.bar.fill" md="admin_panel_settings" />
          <NativeTabs.Trigger.Label>Admin</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
