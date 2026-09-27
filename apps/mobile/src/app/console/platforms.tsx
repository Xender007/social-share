import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PlatformIcon } from '@/components/platform';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Toggle } from '@/components/ui/toggle';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/theme/use-theme';

function ToggleRow({ label, detail, value, onChange, testID }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text role="bodyLarge">{label}</Text>
        {detail ? (
          <Text role="bodySmall" color="onSurfaceVariant">
            {detail}
          </Text>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={label} testID={testID} />
    </View>
  );
}

export default function PlatformsFeaturesScreen() {
  const qc = useQueryClient();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const platforms = useQuery({ queryKey: ['admin', 'platforms'], queryFn: api.admin.platforms });
  const features = useQuery({ queryKey: ['admin', 'features'], queryFn: api.admin.features });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
    void qc.invalidateQueries({ queryKey: ['capabilities'] });
  };
  const onError = (e: unknown) => Alert.alert('Change failed', e instanceof ApiError ? e.message : 'Please try again.');

  const togglePlatform = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.admin.updatePlatform(id, enabled, 'Owner console'), onSuccess: done, onError });
  const togglePlatformFeature = useMutation({ mutationFn: ({ platformId, featureId, enabled }: { platformId: string; featureId: string; enabled: boolean }) => api.admin.updatePlatformFeature(platformId, featureId, enabled), onSuccess: done, onError });
  const toggleFeature = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.admin.updateFeature(id, enabled, 'Owner console'), onSuccess: done, onError });

  const confirmPlatform = (id: string, name: string, enabled: boolean) => {
    if (enabled) return togglePlatform.mutate({ id, enabled });
    Alert.alert(`Turn off ${name}?`, `${name} disappears from the app and new posts to it are blocked. Connections and history are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: () => togglePlatform.mutate({ id, enabled }) },
    ]);
  };

  if (platforms.isLoading || features.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (platforms.error || features.error) return <Screen underHeader><ErrorState message={((platforms.error ?? features.error) as Error).message} onRetry={() => void platforms.refetch()} /></Screen>;

  return (
    <Screen underHeader>
      <Text role="bodyMedium" color="onSurfaceVariant">
        Changes apply to the app right away. Every change is recorded in the audit log.
      </Text>

      <Text role="titleMedium" accessibilityRole="header">
        Platforms
      </Text>
      {platforms.data!.map((p, index) => (
        <Animated.View key={p.id} entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(300)}>
          <Card variant="outlined" style={styles.card}>
            <View style={styles.header}>
              <PlatformIcon platform={p.code} size={26} />
              <View style={styles.flex}>
                <Text role="titleMedium">{p.name}</Text>
                <View style={styles.statusRow}>
                  <MaterialCommunityIcons name={p.enabled ? 'check-circle' : 'circle-outline'} size={14} color={p.enabled ? colors.success : colors.onSurfaceVariant} />
                  <Text role="labelMedium" color={p.enabled ? 'success' : 'onSurfaceVariant'}>
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </Text>
                </View>
              </View>
              <Toggle value={p.enabled} onValueChange={(v) => confirmPlatform(p.id, p.name, v)} accessibilityLabel={`${p.name} enabled`} testID={`platform-${p.code}`} />
            </View>
            {p.enabled
              ? p.features.map((f) => (
                  <ToggleRow key={f.featureId} label={f.featureName} value={f.enabled} onChange={(v) => togglePlatformFeature.mutate({ platformId: p.id, featureId: f.featureId, enabled: v })} />
                ))
              : null}
          </Card>
        </Animated.View>
      ))}

      <Text role="titleMedium" accessibilityRole="header">
        Features (everywhere)
      </Text>
      <Card variant="outlined" style={styles.card}>
        {features.data!.map((f) => (
          <ToggleRow key={f.id} label={f.name} detail={`${f.scope === 'GLOBAL' ? 'App-wide' : 'Per platform'} · ${f.description ?? f.code}`} value={f.enabled} onChange={(v) => toggleFeature.mutate({ id: f.id, enabled: v })} testID={`feature-${f.code}`} />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingBottom: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
});
