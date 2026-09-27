import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PlatformLabel } from '@/components/platform';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Banner, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { api, ApiError } from '@/lib/api';
import { platformBrand } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** One active destination per platform while multi-account is off (§13.2). */
export default function ChooseAccountsScreen() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ['connections'], queryFn: api.connections });
  const connection = connections.data?.find((c) => c.id === connectionId);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!connection) return;
    const initial: Record<string, string> = {};
    for (const a of connection.accounts) if (a.status === 'ACTIVE') initial[a.platform] = a.id;
    setChosen(initial);
  }, [connection]);

  const save = useMutation({
    mutationFn: () => api.setDestinations(connectionId, Object.values(chosen)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['connections'] });
      void qc.invalidateQueries({ queryKey: ['capabilities'] });
      router.back();
    },
  });

  if (connections.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (connections.error) {
    return (
      <Screen underHeader>
        <ErrorState message={connections.error instanceof ApiError ? connections.error.message : 'Could not load connections.'} onRetry={connections.refetch} />
      </Screen>
    );
  }
  if (!connectionId || !connection) {
    // Finished loading but there's no connection to choose accounts for (missing/invalid connectionId,
    // e.g. a bare deep link). Show a way out instead of spinning forever.
    return (
      <Screen underHeader>
        <ErrorState
          message="This connection couldn't be found. Go back and open Choose accounts from a specific connection."
          onRetry={() => router.back()}
          actionLabel="Go back"
          actionIcon="arrow-left"
        />
      </Screen>
    );
  }
  const platforms = [...new Set(connection.accounts.map((a) => a.platform))];
  let cardIndex = 0;

  return (
    <Screen underHeader footer={<Button label="Save" onPress={() => save.mutate()} loading={save.isPending} fullWidth />}>
      <Text role="bodyMedium" color="onSurfaceVariant">
        Choose which account each platform should publish to.
      </Text>
      {save.error ? <Banner tone="error" message={save.error instanceof ApiError ? save.error.message : 'Could not save.'} /> : null}
      {platforms.map((platform) => (
        <View key={platform} style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={platformBrand[platform]?.name ?? platform}>
          <Text role="titleSmall" accessibilityRole="header">
            {platformBrand[platform]?.name ?? platform}
          </Text>
          {connection.accounts
            .filter((a) => a.platform === platform)
            .map((account) => {
              const selected = chosen[platform] === account.id;
              const eligible = account.status !== 'NOT_ELIGIBLE';
              const entranceIndex = cardIndex++;
              return (
                <Animated.View key={account.id} entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(entranceIndex, 8) * 40).duration(300)}>
                  <Card variant="outlined" style={[styles.optionCard, selected ? { backgroundColor: colors.primaryContainer, borderColor: colors.primary } : null]}>
                    <Pressable
                      disabled={!eligible}
                      onPress={() => setChosen((c) => ({ ...c, [platform]: account.id }))}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !eligible }}
                      style={[styles.row, !eligible && styles.disabled]}>
                      <View style={styles.flex}>
                        <PlatformLabel platform={platform} name={account.handle ?? account.displayName} detail={eligible ? null : (account.statusReason ?? 'Not eligible for publishing')} />
                      </View>
                      <MaterialCommunityIcons name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'} size={24} color={selected ? colors.primary : colors.onSurfaceVariant} />
                    </Pressable>
                  </Card>
                </Animated.View>
              );
            })}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  flex: { flex: 1 },
  optionCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12 },
  disabled: { opacity: 0.5 },
});
