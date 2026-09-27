import type { AnalyticsRange } from '@sp/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedStat } from '@/components/screens/analytics-animated-stat';
import { compactNumber, LineChart } from '@/components/line-chart';
import { Chip } from '@/components/platform';
import { Card } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { platformBrand, radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export default function AccountAnalyticsScreen() {
  const { colors } = useTheme();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const query = useQuery({ queryKey: ['analytics', 'account', accountId, range], queryFn: () => api.accountMetrics(accountId, range) });

  if (query.isLoading) {
    return (
      <Screen underHeader>
        <View style={styles.chips}>
          {(['7d', '30d', '90d', '1y'] as AnalyticsRange[]).map((r) => (
            <Chip key={r} label={r.toUpperCase()} selected={range === r} onPress={() => setRange(r)} />
          ))}
        </View>
        <View style={styles.skeletonWrap}>
          <Skeleton height={140} style={styles.skeletonBlock} />
          <Skeleton height={140} style={styles.skeletonBlock} />
        </View>
      </Screen>
    );
  }
  if (query.error || !query.data) return <Screen underHeader><ErrorState message={(query.error as Error)?.message ?? 'No data'} onRetry={query.refetch} /></Screen>;

  const data = query.data;
  const brand = platformBrand[data.platform];

  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: `${brand?.name ?? data.platform} · ${data.accountName}` }} />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Date range">
        {(['7d', '30d', '90d', '1y'] as AnalyticsRange[]).map((r) => (
          <Chip key={r} label={r.toUpperCase()} selected={range === r} onPress={() => setRange(r)} />
        ))}
      </View>
      {data.series.length === 0 ? (
        <Text role="bodyMedium" color="onSurfaceVariant">
          No metrics for this range yet.
        </Text>
      ) : (
        data.series.map((series) => {
          const total = series.points.reduce((sum, p) => sum + p.value, 0);
          const latest = series.points[series.points.length - 1]?.value ?? 0;
          const isTotal = /total|followers|subscribers/i.test(series.metricKey);
          const value = isTotal ? latest : total;
          return (
            <Card key={series.metricKey} variant="outlined" style={styles.card}>
              <View style={styles.header}>
                <Text role="titleSmall" color="onSurfaceVariant">
                  {series.label}
                </Text>
                <AnimatedStat value={value} format={(n) => `${series.approximate ? '≈' : ''}${compactNumber(n)}`} role="headlineSmall" />
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                {isTotal ? 'Latest value' : 'Total for this period'}
                {series.approximate ? ' · rounded by the platform' : ''}
              </Text>
              <LineChart series={[{ label: series.label, color: brand?.color ?? colors.accent, points: series.points }]} height={120} />
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8 },
  card: { gap: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  skeletonWrap: { gap: 12 },
  skeletonBlock: { borderRadius: radius.lg },
});
