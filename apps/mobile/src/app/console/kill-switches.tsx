import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Chip } from '@/components/platform';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Banner, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/theme/use-theme';

const PLATFORM_OPTIONS = [
  { value: '', label: 'All platforms' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
];
const FEATURE_OPTIONS = [
  { value: 'publish', label: 'Publishing' },
  { value: 'analytics', label: 'Analytics' },
  { value: '', label: 'Everything' },
];

export default function KillSwitchesScreen() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'kill-switches'], queryFn: api.admin.killSwitches });
  const [platformCode, setPlatformCode] = useState('instagram');
  const [featureCode, setFeatureCode] = useState('publish');
  const [reason, setReason] = useState('');
  const done = () => {
    setReason('');
    void qc.invalidateQueries({ queryKey: ['admin'] });
    void qc.invalidateQueries({ queryKey: ['capabilities'] });
  };
  const activate = useMutation({ mutationFn: () => api.admin.activateKillSwitch({ platformCode: platformCode || undefined, featureCode: featureCode || undefined, pauseQueuedJobs: true, reason: reason.trim() }), onSuccess: done });
  const deactivate = useMutation({ mutationFn: (id: string) => api.admin.deactivateKillSwitch(id), onSuccess: done });

  const scopeInvalid = !platformCode && !featureCode;
  const confirmActivate = () =>
    Alert.alert('Activate kill switch?', 'Matching publishing is paused immediately and hidden in the app. Nothing is deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Activate', style: 'destructive', onPress: () => activate.mutate() },
    ]);

  const active = (list.data ?? []).filter((k) => k.active);
  const history = (list.data ?? []).filter((k) => !k.active).slice(0, 10);

  return (
    <Screen underHeader>
      {list.isLoading ? <LoadingState /> : null}
      {active.length === 0 && !list.isLoading ? <Banner tone="success" message="No kill switches are active." /> : null}
      {active.map((k) => (
        <Card key={k.id} variant="outlined" style={[styles.activeCard, { backgroundColor: colors.errorContainer, borderColor: colors.error }]}>
          <View style={styles.activeHeader}>
            <View style={[styles.activeIcon, { backgroundColor: colors.error }]}>
              <MaterialCommunityIcons name="alert-octagon" size={20} color={colors.onError} />
            </View>
            <View style={styles.flex}>
              <Text role="titleSmall" color="onErrorContainer">
                {[k.featureCode ?? 'Everything', k.platformCode ? `on ${k.platformCode}` : 'on all platforms'].join(' ')}
              </Text>
              <Text role="bodySmall" color="onErrorContainer">
                Active since {new Date(k.activatedAt).toLocaleString()}
              </Text>
            </View>
          </View>
          <Text role="bodyMedium" color="onErrorContainer">
            {k.reason}
          </Text>
          <Button label="Deactivate" icon="play-circle-outline" variant="tonal" onPress={() => deactivate.mutate(k.id)} loading={deactivate.isPending && deactivate.variables === k.id} />
        </Card>
      ))}

      <Card variant="filled" style={styles.card}>
        <Text role="titleMedium" accessibilityRole="header">
          New kill switch
        </Text>
        <Text role="labelMedium" color="onSurfaceVariant">
          Platform
        </Text>
        <View style={styles.chips}>
          {PLATFORM_OPTIONS.map((o) => (
            <Chip key={o.label} label={o.label} selected={platformCode === o.value} onPress={() => setPlatformCode(o.value)} />
          ))}
        </View>
        <Text role="labelMedium" color="onSurfaceVariant">
          Feature
        </Text>
        <View style={styles.chips}>
          {FEATURE_OPTIONS.map((o) => (
            <Chip key={o.label} label={o.label} selected={featureCode === o.value} onPress={() => setFeatureCode(o.value)} />
          ))}
        </View>
        <TextField label="Reason *" value={reason} onChangeText={setReason} helper="Shown to anyone using the app, e.g. “Meta outage”." error={scopeInvalid ? 'Choose a platform or a feature.' : null} />
        {activate.error ? <Banner tone="error" message={activate.error instanceof ApiError ? activate.error.message : 'Could not activate.'} /> : null}
        <Button label="Activate" icon="alert-octagon-outline" variant="danger" onPress={confirmActivate} disabled={reason.trim().length < 3 || scopeInvalid} loading={activate.isPending} fullWidth />
      </Card>

      {history.length > 0 ? (
        <View style={styles.section}>
          <Text role="titleMedium" accessibilityRole="header">
            History
          </Text>
          {history.map((k) => (
            <View key={k.id} style={styles.historyRow}>
              <MaterialCommunityIcons name="check-circle-outline" size={14} color={colors.onSurfaceVariant} />
              <Text role="bodySmall" color="onSurfaceVariant" style={styles.flex}>
                {new Date(k.activatedAt).toLocaleDateString()} · {k.featureCode ?? 'everything'} {k.platformCode ? `on ${k.platformCode}` : ''} · {k.reason}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 8 },
  activeCard: { gap: 8, borderWidth: 1.5 },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  activeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { gap: 6 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
