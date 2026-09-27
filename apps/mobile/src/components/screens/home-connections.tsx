import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { CapabilityPlatformView } from '@sp/contracts';
import { ScrollView, StyleSheet, View } from 'react-native';
import { PlatformIcon } from '@/components/platform';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/theme/use-theme';

const CONNECTION_LABEL: Record<string, { text: string; icon: 'check-circle' | 'alert-circle' | 'link-variant'; tone: 'success' | 'error' | 'onSurfaceVariant' }> = {
  CONNECTED: { text: 'Connected', icon: 'check-circle', tone: 'success' },
  REAUTH_REQUIRED: { text: 'Reconnect', icon: 'alert-circle', tone: 'error' },
  REFRESH_FAILING: { text: 'Check connection', icon: 'alert-circle', tone: 'error' },
  NOT_CONNECTED: { text: 'Not connected', icon: 'link-variant', tone: 'onSurfaceVariant' },
};

/** Horizontal row of platform tiles (tinted icon, name, handle, status). Each tile opens Connections. */
export function HomeConnectionsRow({ platforms, onPress }: { platforms: CapabilityPlatformView[]; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {platforms.map((platform) => {
        const status = CONNECTION_LABEL[platform.connection.status] ?? CONNECTION_LABEL.NOT_CONNECTED;
        const account = platform.connection.accounts.find((a) => a.status === 'ACTIVE') ?? platform.connection.accounts[0];
        const detail = account ? (account.handle ?? account.displayName) : 'Not connected';
        return (
          <Card
            key={platform.code}
            variant="outlined"
            style={styles.tile}
            onPress={onPress}
            accessibilityLabel={`${platform.name}: ${status.text}, ${detail}`}>
            <PlatformIcon platform={platform.code} size={26} />
            <Text role="titleSmall" numberOfLines={1} style={styles.name}>
              {platform.name}
            </Text>
            <Text role="bodySmall" color="onSurfaceVariant" numberOfLines={1}>
              {detail}
            </Text>
            <View style={styles.status}>
              <MaterialCommunityIcons name={status.icon} size={14} color={colors[status.tone]} />
              <Text role="labelMedium" color={status.tone}>
                {status.text}
              </Text>
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 12, paddingRight: 4 },
  tile: { width: 152, gap: 6, minHeight: 118 },
  name: { marginTop: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
});
