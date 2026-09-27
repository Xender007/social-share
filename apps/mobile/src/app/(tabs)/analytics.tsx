import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AnalyticsRange } from '@sp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedStat } from '@/components/screens/analytics-animated-stat';
import { compactNumber, LineChart } from '@/components/line-chart';
import { Chip, PlatformIcon, PlatformLabel } from '@/components/platform';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useCapabilities } from '@/hooks/use-capabilities';
import { api, ApiError } from '@/lib/api';
import { platformBrand, radius, type ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const CHART_DASH: Record<string, string> = { youtube: '10 5', instagram: '2 5', facebook: '14 4 3 4' };

const RANGES: Array<{ value: AnalyticsRange; label: string }> = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '1y', label: '1Y' },
];

/** Up/down chip communicating change by icon + text, never colour alone. */
function DeltaChip({ change }: { change: number }) {
  const { colors } = useTheme();
  const up = change >= 0;
  const bg = up ? colors.successContainer : colors.errorContainer;
  const fg: keyof ColorScheme = up ? 'onSuccessContainer' : 'onErrorContainer';
  return (
    <View style={[styles.deltaChip, { backgroundColor: bg }]}>
      <MaterialCommunityIcons name={up ? 'arrow-up' : 'arrow-down'} size={14} color={colors[fg]} />
      <Text role="labelMedium" color={fg}>
        {up ? '+' : ''}
        {compactNumber(change)} this period
      </Text>
    </View>
  );
}

const RANK_TONE: Array<{ bg: keyof ColorScheme; fg: keyof ColorScheme }> = [
  { bg: 'primary', fg: 'onPrimary' },
  { bg: 'secondaryContainer', fg: 'onSecondaryContainer' },
  { bg: 'warningContainer', fg: 'onWarningContainer' },
];

function RankBadge({ index }: { index: number }) {
  const { colors } = useTheme();
  const tone = RANK_TONE[index];
  return (
    <View
      style={[
        styles.rankBadge,
        tone ? { backgroundColor: colors[tone.bg] } : { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.outlineVariant },
      ]}>
      <Text role="labelLarge" color={tone?.fg ?? 'onSurfaceVariant'}>
        {index + 1}
      </Text>
    </View>
  );
}

function AnalyticsSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <Skeleton height={132} style={styles.skeletonHero} />
      <View style={styles.grid}>
        <Skeleton height={92} style={styles.skeletonCard} />
        <Skeleton height={92} style={styles.skeletonCard} />
      </View>
      <Skeleton height={220} style={styles.skeletonChart} />
      <Skeleton height={64} style={styles.skeletonRow} />
      <Skeleton height={64} style={styles.skeletonRow} />
      <Skeleton height={64} style={styles.skeletonRow} />
    </View>
  );
}

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { caps } = useCapabilities();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const overview = useQuery({ queryKey: ['analytics', 'overview', range], queryFn: () => api.overview(range) });
  const audience = useQuery({ queryKey: ['analytics', 'audience', range], queryFn: () => api.audience(range) });
  const top = useQuery({ queryKey: ['analytics', 'top', range], queryFn: () => api.topPosts(range) });
  const sync = useMutation({
    mutationFn: api.syncAnalytics,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['analytics'] }),
  });

  const analyticsAccounts = (caps?.platforms ?? []).filter((p) => p.capabilities.analytics).flatMap((p) => p.connection.accounts.filter((a) => a.status !== 'DISCONNECTED').map((a) => ({ platform: p, account: a })));

  const header = (
    <View style={styles.controls}>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Date range">
        {RANGES.map((r) => (
          <Chip key={r.value} label={r.label} selected={range === r.value} onPress={() => setRange(r.value)} />
        ))}
      </View>
      <Button label={sync.isPending ? 'Syncing' : 'Sync'} icon="sync" variant="text" loading={sync.isPending} onPress={() => sync.mutate()} />
    </View>
  );

  if (overview.isLoading) {
    return (
      <Screen title="Analytics">
        {header}
        <AnalyticsSkeleton />
      </Screen>
    );
  }
  if (overview.error) {
    const denied = overview.error instanceof ApiError && overview.error.code === 'CAPABILITY_DENIED';
    return (
      <Screen title="Analytics">
        {denied ? <EmptyState icon="chart-line" title="Analytics unavailable" message={overview.error.message} /> : <ErrorState message={(overview.error as Error).message} onRetry={overview.refetch} />}
      </Screen>
    );
  }

  const data = overview.data!;
  const heroCard = data.cards.find((c) => c.group === 'audience_total');
  const otherCards = data.cards.filter((c) => c.group !== 'audience_total');
  const chartSeries = (audience.data?.series ?? [])
    .filter((s) => s.points.length > 1)
    .map((s) => ({
      label: s.isDerived ? 'Total (derived)' : (platformBrand[s.platform ?? '']?.name ?? s.label),
      color: s.isDerived ? colors.primary : (platformBrand[s.platform ?? '']?.color ?? colors.accent),
      points: s.points,
      dashed: !s.isDerived,
      // YouTube red and Instagram pink look alike, so each platform also gets its own line pattern.
      dash: s.isDerived ? undefined : CHART_DASH[s.platform ?? ''],
    }));

  return (
    <Screen
      title="Analytics"
      subtitle={data.lastSyncedAt ? `Updated ${new Date(data.lastSyncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'}
      refreshing={overview.isRefetching}
      onRefresh={() => void qc.invalidateQueries({ queryKey: ['analytics'] })}>
      {header}

      {data.cards.length === 0 ? (
        <EmptyState icon="chart-box-outline" title="No analytics yet" message="Connect an account and tap Sync to pull your numbers." actionLabel="Sync now" onAction={() => sync.mutate()} />
      ) : (
        <>
          {heroCard ? (
            <Card variant="gradient" style={styles.heroCard} accessibilityLabel={`${heroCard.label} ${heroCard.value}`}>
              <Text role="labelMedium" color="onGradient" style={styles.heroLabel}>
                {heroCard.label.toUpperCase()}
              </Text>
              <AnimatedStat
                value={heroCard.value}
                format={(n) => `${heroCard.approximate ? '≈' : ''}${compactNumber(n)}`}
                role="displaySmall"
                color="onGradient"
              />
              <View style={styles.heroFooter}>
                {heroCard.change !== null ? <DeltaChip change={heroCard.change} /> : null}
                {heroCard.footnote ? (
                  <Text role="bodySmall" color="onGradient" style={styles.heroFootnote}>
                    {heroCard.footnote}
                  </Text>
                ) : null}
              </View>
              {heroCard.breakdown.length > 0 ? (
                <View style={styles.breakdown}>
                  {heroCard.breakdown.map((b) => (
                    <View key={b.socialAccountId} style={styles.breakdownItem}>
                      <PlatformIcon platform={b.platform} size={14} />
                      <Text role="bodySmall" color="onGradient">
                        {compactNumber(b.value)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          {otherCards.length > 0 ? (
            <View style={styles.grid}>
              {otherCards.map((card) => (
                <Card key={card.group} variant="filled" style={styles.card}>
                  <Text role="labelMedium" color="onSurfaceVariant">
                    {card.label}
                  </Text>
                  <AnimatedStat
                    value={card.value}
                    format={(n) => `${card.approximate ? '≈' : ''}${compactNumber(n)}`}
                    role="headlineSmall"
                  />
                  {card.change !== null ? <DeltaChip change={card.change} /> : null}
                  <View style={styles.breakdown}>
                    {card.breakdown.map((b) => (
                      <View key={b.socialAccountId} style={styles.breakdownItem}>
                        <PlatformIcon platform={b.platform} size={14} />
                        <Text role="bodySmall" color="onSurfaceVariant">
                          {compactNumber(b.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Card>
              ))}
            </View>
          ) : null}
        </>
      )}

      <Card variant="outlined" style={styles.chartCard}>
        <Text role="titleMedium" accessibilityRole="header">
          Audience growth
        </Text>
        {audience.isLoading ? <Skeleton height={180} /> : <LineChart series={chartSeries} />}
      </Card>

      {analyticsAccounts.length > 0 ? (
        <View style={styles.section}>
          <Text role="titleMedium" accessibilityRole="header">
            Accounts
          </Text>
          {analyticsAccounts.map(({ platform, account }) => (
            <Card key={account.id} variant="outlined" onPress={() => router.push({ pathname: '/analytics/[accountId]', params: { accountId: account.id } })} accessibilityLabel={`${platform.name} analytics`}>
              <View style={styles.rowBetween}>
                <PlatformLabel platform={platform.code} name={platform.name} detail={account.handle ?? account.displayName} />
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurfaceVariant} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text role="titleMedium" accessibilityRole="header">
          Top posts
        </Text>
        {top.isLoading ? (
          <View style={styles.skeletonWrap}>
            <Skeleton height={64} style={styles.skeletonRow} />
            <Skeleton height={64} style={styles.skeletonRow} />
            <Skeleton height={64} style={styles.skeletonRow} />
          </View>
        ) : (top.data?.items ?? []).length === 0 ? (
          <Text role="bodyMedium" color="onSurfaceVariant">
            Posts published in this period will be ranked here.
          </Text>
        ) : (
          top.data!.items.map((row, index) => (
            <Card key={row.postId} variant="outlined" onPress={() => router.push(`/posts/${row.postId}`)} accessibilityLabel={`Rank ${index + 1}: ${row.title ?? 'Untitled'}, ${row.totals.views} views`}>
              <View style={styles.rowBetween}>
                <RankBadge index={index} />
                <View style={styles.flex}>
                  <Text role="titleSmall" numberOfLines={1}>
                    {row.title ?? 'Untitled video'}
                  </Text>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    {compactNumber(row.totals.views)} views · {compactNumber(row.totals.likes)} likes · {compactNumber(row.totals.comments)} comments
                  </Text>
                </View>
                <View style={styles.icons}>
                  {row.perPlatform.map((p) => (
                    <PlatformIcon key={p.platform} platform={p.platform} size={16} />
                  ))}
                </View>
              </View>
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', gap: 8 },
  heroCard: { gap: 8, paddingVertical: 20 },
  heroLabel: { opacity: 0.85 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  heroFootnote: { opacity: 0.85 },
  deltaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { flexBasis: '47%', flexGrow: 1, gap: 6 },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chartCard: { gap: 12 },
  section: { gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  icons: { flexDirection: 'row', gap: 4 },
  skeletonWrap: { gap: 12 },
  skeletonHero: { borderRadius: radius.lg },
  skeletonCard: { flexBasis: '47%', flexGrow: 1, borderRadius: radius.lg },
  skeletonChart: { borderRadius: radius.lg },
  skeletonRow: { borderRadius: radius.lg },
});
