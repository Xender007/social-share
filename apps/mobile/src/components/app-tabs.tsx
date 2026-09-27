import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '@/theme/use-theme';

/** Bottom navigation: 4 top-level destinations with labels (Material 3 navigation bar). */
export default function AppTabs() {
  const { colors } = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.surface}
      indicatorColor={colors.primaryContainer}
      tintColor={colors.primary}
      labelStyle={{ default: { color: colors.onSurfaceVariant }, selected: { color: colors.primary } }}
      iconColor={{ default: colors.onSurfaceVariant, selected: colors.onPrimaryContainer }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="posts">
        <NativeTabs.Trigger.Label>Posts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="play.rectangle.on.rectangle" md="video_library" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="analytics">
        <NativeTabs.Trigger.Label>Analytics</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar.xaxis" md="insights" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
