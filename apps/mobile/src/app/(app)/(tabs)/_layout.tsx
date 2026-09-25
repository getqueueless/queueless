import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  // useTheme follows the in-app Appearance choice. The selected label is text, so it takes the
  // AA text cyan, not `primary` (2.40:1 on white).
  const colors = useTheme();

  return (
    <NativeTabs
      backgroundColor={colors.surface}
      tintColor={colors.primaryText}
      iconColor={colors.inkMuted}
      indicatorColor={colors.primarySoft}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="appointments">
        <NativeTabs.Trigger.Label>Appointments</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
