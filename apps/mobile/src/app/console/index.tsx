import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PlatformLabel } from '@/components/platform';
import { Button, type IconName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Banner, ErrorState, LoadingState } from '@/components/ui/feedback';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import type { ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const ATTENTION = ['NEEDS_USER_ACTION', 'UNKNOWN_OUTCOME', 'FAILED_FINAL', 'PAUSED'] as const;

function StatTile({ label, value, tone = 'onSurface', onPress, accessibilityLabel }: { label: string; value: number; tone?: keyof ColorScheme; onPress?: () => void; accessibilityLabel?: string }) {
  return (
    <Card variant="elevated" style={styles.stat} onPress={onPress} accessibilityLabel={accessibilityLabel}>
      <Text role="labelMedium" color="onSurfaceVariant">
        {label}
      </Text>
      <Text role="stat" color={tone}>
        {value}
      </Text>
    </Card>
  );
}

/** Navigation row: tinted icon circle, label + sublabel, trailing chevron. */
function NavRow({ icon, label, sublabel, onPress, last }: { icon: IconName; label: string; sublabel: string; onPress: () => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.navRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outlineVariant }]}>
      <View style={[styles.navIcon, { backgroundColor: colors.primaryContainer }]}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.onPrimaryContainer} />
      </View>
      <View style={styles.flex}>
        <Text role="titleSmall">{label}</Text>
        <Text role="bodySmall" color="onSurfaceVariant">
          {sublabel}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
    </PressableScale>
  );
}

export default function ConsoleOverviewScreen() {
  const reducedMotion = useReducedMotion();
  const query = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.admin.overview, refetchInterval: 10_000 });
  if (query.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (query.error || !query.data) return <Screen underHeader><ErrorState message={(query.error as Error)?.message ?? 'Unavailable'} onRetry={query.refetch} /></Screen>;
  const data = query.data;
  const attention = ATTENTION.reduce((sum, s) => sum + (data.publicationsByStatus[s] ?? 0), 0);
  const failed = data.publicationsByStatus.FAILED_FINAL ?? 0;
  const activeSwitches = data.activeKillSwitches.length;

  return (
    <Screen underHeader refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      {data.activeKillSwitches.map((k) => (
        <Banner
          key={k.id}
          tone="error"
          title="Kill switch active"
          message={`${[k.featureCode, k.platformCode].filter(Boolean).join(' on ')}: ${k.reason}`}
          action={<Button label="Manage" variant="text" onPress={() => router.push('/console/kill-switches')} />}
        />
      ))}

      <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(300)} style={styles.stats}>
        <StatTile label="Published" value={data.publicationsByStatus.PUBLISHED ?? 0} tone="success" />
        <StatTile label="Queued" value={data.publicationsByStatus.QUEUED ?? 0} />
        <StatTile
          label="Need attention"
          value={attention}
          tone={attention > 0 ? 'error' : 'onSurface'}
          onPress={() => router.push('/console/publications')}
          accessibilityLabel={`${attention} publications need attention`}
        />
        <StatTile label="Failed" value={failed} tone={failed > 0 ? 'error' : 'onSurface'} onPress={() => router.push('/console/publications')} />
      </Animated.View>

      <View style={styles.section}>
        <Text role="titleMedium" accessibilityRole="header">
          Manage
        </Text>
        <Card variant="outlined" style={styles.navList}>
          <NavRow icon="tune-variant" label="Platforms & features" sublabel="Turn platforms and features on or off" onPress={() => router.push('/console/platforms')} />
          <NavRow icon="alert-octagon-outline" label="Kill switches" sublabel={activeSwitches > 0 ? `${activeSwitches} active` : 'Pause publishing in an emergency'} onPress={() => router.push('/console/kill-switches')} />
          <NavRow icon="timeline-clock-outline" label="Publishing queue" sublabel="Everything queued, running or stuck" onPress={() => router.push('/console/publications')} />
          <NavRow icon="clipboard-text-clock-outline" label="Audit log" sublabel="Every configuration change" onPress={() => router.push('/console/audit')} last />
        </Card>
      </View>

      <View style={styles.section}>
        <Text role="titleMedium" accessibilityRole="header">
          Platform health
        </Text>
        {data.platformHealth.map((p) => (
          <Card key={p.platform} variant="outlined">
            <View style={styles.row}>
              <PlatformLabel platform={p.platform} detail={`${p.published24h} published · ${p.failed24h} failed (24h)`} />
              <Text role="titleSmall" color={p.successRate7d === null ? 'onSurfaceVariant' : p.successRate7d >= 0.9 ? 'success' : 'warning'}>
                {p.successRate7d === null ? '—' : `${Math.round(p.successRate7d * 100)}%`}
              </Text>
            </View>
          </Card>
        ))}
        <Text role="bodySmall" color="onSurfaceVariant">
          Percent is the 7-day success rate.
        </Text>
      </View>

      <View style={styles.section}>
        <Text role="titleMedium" accessibilityRole="header">
          Job queues
        </Text>
        <Card variant="outlined" style={styles.list}>
          {data.queues
            .filter((q) => !q.name.startsWith('cron.'))
            .map((q) => (
              <View key={q.name} style={styles.queueRow}>
                <Text role="bodyMedium" style={styles.flex}>
                  {q.name}
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  {q.queued} queued · {q.active} active
                </Text>
              </View>
            ))}
        </Card>
      </View>

      <View style={styles.section}>
        <Text role="titleMedium" accessibilityRole="header">
          Recent syncs
        </Text>
        {data.lastSyncRuns.length === 0 ? (
          <Text role="bodyMedium" color="onSurfaceVariant">
            No analytics syncs yet.
          </Text>
        ) : (
          data.lastSyncRuns.slice(0, 5).map((run, i) => (
            <Text key={`${run.kind}-${i}`} role="bodySmall" color={run.status === 'FAILED' ? 'error' : 'onSurfaceVariant'}>
              {new Date(run.startedAt).toLocaleTimeString()} · {run.kind} · {run.status}
              {run.error ? ` · ${run.error}` : ''}
            </Text>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  section: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { paddingVertical: 4 },
  queueRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  navList: { padding: 0 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  navIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
