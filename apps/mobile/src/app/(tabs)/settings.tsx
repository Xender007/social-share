import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { EditNameSheet } from '@/components/screens/edit-name-sheet';
import { Button, type IconName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Banner } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useCapabilities } from '@/hooks/use-capabilities';
import { api } from '@/lib/api';
import { API_BASE_URL, APP_VERSION } from '@/lib/config';
import { askForPushAfterPublish } from '@/lib/push';
import { useSession } from '@/lib/session';
import { radius, touchTarget, type ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

function RowIcon({ icon, tone = 'primary' }: { icon: IconName; tone?: 'primary' | 'accent' }) {
  const { colors } = useTheme();
  const bg: keyof ColorScheme = tone === 'accent' ? 'secondaryContainer' : 'primaryContainer';
  const fg: keyof ColorScheme = tone === 'accent' ? 'onSecondaryContainer' : 'onPrimaryContainer';
  return (
    <View style={[styles.rowIcon, { backgroundColor: colors[bg] }]}>
      <MaterialCommunityIcons name={icon} size={20} color={colors[fg]} />
    </View>
  );
}

function Row({ icon, label, detail, href, onPress, tone }: { icon: IconName; label: string; detail?: string; href?: Href; onPress?: () => void; tone?: 'primary' | 'accent' }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress ?? (() => href && router.push(href))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      android_ripple={{ color: 'rgba(99,102,241,0.14)' }}
      style={styles.row}>
      <RowIcon icon={icon} tone={tone} />
      <View style={styles.flex}>
        <Text role="bodyLarge">{label}</Text>
        {detail ? (
          <Text role="bodySmall" color="onSurfaceVariant" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { caps } = useCapabilities();
  const signOut = useSession((s) => s.signOut);
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const permission = useQuery({ queryKey: ['push-permission'], queryFn: () => Notifications.getPermissionsAsync() });
  const [editingName, setEditingName] = useState(false);

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'Your drafts stay on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  const initial = (caps?.user.displayName ?? caps?.user.email ?? '?').slice(0, 1).toUpperCase();

  return (
    <Screen title="Settings">
      {health.data?.providerMode === 'fake' ? (
        <Banner tone="info" title="Test mode" message="The server is simulating YouTube, Instagram and Facebook. Nothing is posted publicly." />
      ) : null}

      <Card variant="elevated" style={styles.account}>
        <View style={styles.avatar}>
          <GradientFill borderRadius={28} />
          <Text role="titleLarge" color="onGradient">
            {initial}
          </Text>
        </View>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text role="titleLarge">{caps?.user.displayName ?? 'Owner'}</Text>
            <Pressable
              onPress={() => setEditingName(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit name"
              hitSlop={4}
              style={styles.editHit}>
              {({ pressed }) => (
                <View style={[styles.editVisual, { backgroundColor: pressed ? colors.surfaceContainerHigh : colors.surfaceContainer }]}>
                  <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.onSurfaceVariant} />
                </View>
              )}
            </Pressable>
          </View>
          <Text role="bodyMedium" color="onSurfaceVariant" numberOfLines={1}>
            {caps?.user.email}
          </Text>
          <View style={[styles.rolePill, { backgroundColor: colors.primaryContainer }]}>
            <Text role="labelMedium" color="onPrimaryContainer">
              {caps?.user.accessLevel}
            </Text>
          </View>
        </View>
      </Card>

      <EditNameSheet open={editingName} onOpenChange={setEditingName} currentName={caps?.user.displayName ?? ''} />

      <View style={styles.section}>
        <Text role="titleSmall" color="onSurfaceVariant" accessibilityRole="header">
          General
        </Text>
        <Card variant="outlined" style={styles.list}>
          <Row icon="link-variant" label="Connections" detail="YouTube, Instagram, Facebook" href="/connections" />
          <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
          <Row
            icon="bell-outline"
            label="Notifications"
            tone="accent"
            detail={permission.data?.status === 'granted' ? 'On — you will hear when publishing finishes' : 'Off — tap to turn on'}
            onPress={async () => {
              await askForPushAfterPublish();
              void permission.refetch();
            }}
          />
        </Card>
      </View>

      {caps?.global.admin ? (
        <View style={styles.section}>
          <Text role="titleSmall" color="onSurfaceVariant" accessibilityRole="header">
            Owner console
          </Text>
          <Card variant="outlined" style={styles.list}>
            <Row icon="view-dashboard-outline" label="Overview" detail="Queues, platform health, recent failures" href="/console" />
            <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
            <Row icon="toggle-switch-outline" label="Platforms & features" detail="Turn platforms and features on or off" href="/console/platforms" tone="accent" />
            <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
            <Row icon="alert-octagon-outline" label="Kill switches" detail="Pause publishing during an outage" href="/console/kill-switches" />
            <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
            <Row icon="format-list-checks" label="Publishing queue" detail="Everything in progress or needing attention" href="/console/publications" tone="accent" />
            <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
            <Row icon="history" label="Audit log" detail="Every configuration change" href="/console/audit" />
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text role="titleSmall" color="onSurfaceVariant" accessibilityRole="header">
          About
        </Text>
        <Card variant="outlined">
          <Text role="bodySmall" color="onSurfaceVariant">
            App {APP_VERSION} · Server {API_BASE_URL} · {health.data ? `${health.data.status}, ${health.data.providerMode} providers` : 'checking…'}
          </Text>
        </Card>
      </View>

      <View style={[styles.signOutSection, { borderTopColor: colors.outlineVariant }]}>
        <Button label="Sign out" icon="logout" variant="danger" onPress={confirmSignOut} fullWidth />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  editHit: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  editVisual: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rolePill: { alignSelf: 'flex-start', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 2, marginTop: 4 },
  section: { gap: 8 },
  list: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, minHeight: touchTarget },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  signOutSection: { marginTop: 24, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
