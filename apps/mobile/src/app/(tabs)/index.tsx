import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Button } from '@/components/ui/button';
import { Banner, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { HomeConnectionsRow } from '@/components/screens/home-connections';
import { HomeHeroCard } from '@/components/screens/home-hero';
import { RecentPostCard } from '@/components/screens/home-post-card';
import { HomeStatsStrip, type HomeStat } from '@/components/screens/home-stats';
import { useCapabilities } from '@/hooks/use-capabilities';
import { api } from '@/lib/api';
import { useDraft } from '@/stores/draft';
import { radius } from '@/theme/tokens';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 5;

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Loading skeleton mirroring the real layout, so the screen doesn't jump when data arrives. */
function HomeSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Skeleton width={130} height={14} />
          <Skeleton width={210} height={28} style={styles.skeletonGap} />
        </View>
      </View>
      <Skeleton width="100%" height={184} style={styles.skeletonCard} />
      <View style={styles.statsRow}>
        <Skeleton width="100%" height={74} style={styles.skeletonTile} />
        <Skeleton width="100%" height={74} style={styles.skeletonTile} />
        <Skeleton width="100%" height={74} style={styles.skeletonTile} />
      </View>
      <Skeleton width="100%" height={118} style={styles.skeletonCard} />
      <View style={styles.section}>
        <Skeleton width="100%" height={80} style={styles.skeletonCard} />
        <Skeleton width="100%" height={80} style={styles.skeletonCard} />
        <Skeleton width="100%" height={80} style={styles.skeletonCard} />
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const reducedMotion = useReducedMotion();
  const { caps, isLoading, error, refetch, isRefetching } = useCapabilities();
  const posts = useQuery({ queryKey: ['posts', 'recent'], queryFn: () => api.posts(), refetchInterval: 10_000 });
  const draftVideo = useDraft((s) => s.video);
  const canPublish = (caps?.platforms ?? []).some((p) => p.capabilities.publish);

  if (isLoading) {
    return (
      <Screen>
        <HomeSkeleton />
      </Screen>
    );
  }
  if (error || !caps) {
    return (
      <Screen>
        <ErrorState message={(error as Error)?.message ?? 'Could not load your account.'} onRetry={refetch} />
      </Screen>
    );
  }

  const allPosts = posts.data?.items ?? [];
  const recent = allPosts.slice(0, RECENT_LIMIT);
  const now = Date.now();
  const stats: HomeStat[] = allPosts.length
    ? [
        { label: 'This week', value: allPosts.filter((p) => now - new Date(p.createdAt).getTime() <= WEEK_MS).length },
        { label: 'Published', value: allPosts.filter((p) => p.status === 'PUBLISHED').length, tone: 'success' },
        { label: 'Needs attention', value: allPosts.filter((p) => p.status === 'NEEDS_ATTENTION' || p.status === 'FAILED').length, tone: 'error' },
      ]
    : [];

  const headline = draftVideo ? "Pick up where you left off." : 'Ready to broadcast?';

  return (
    <Screen
      refreshing={isRefetching || posts.isRefetching}
      onRefresh={() => {
        void refetch();
        void posts.refetch();
      }}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text role="bodyMedium" color="onSurfaceVariant">
            {timeOfDayGreeting()}
            {caps.user.displayName ? `, ${caps.user.displayName}` : ''}
          </Text>
          <Text role="headlineMedium" accessibilityRole="header">
            {headline}
          </Text>
        </View>
      </View>

      {caps.notices.map((notice) => (
        <Banner key={`${notice.code}-${notice.platform ?? 'all'}`} tone={notice.level === 'critical' ? 'error' : 'warning'} message={notice.message} />
      ))}

      <HomeHeroCard draftFileName={draftVideo?.fileName ?? null} canPublish={canPublish} onPress={() => router.push('/create')} />

      {stats.length > 0 ? <HomeStatsStrip stats={stats} /> : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text role="titleMedium" accessibilityRole="header">
            Connections
          </Text>
          <Button label="Manage" variant="text" onPress={() => router.push('/connections')} />
        </View>
        <HomeConnectionsRow platforms={caps.platforms} onPress={() => router.push('/connections')} />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text role="titleMedium" accessibilityRole="header">
            Recent posts
          </Text>
          {recent.length > 0 ? <Button label="See all" variant="text" onPress={() => router.push('/posts')} /> : null}
        </View>
        {posts.isLoading ? (
          <View style={styles.section}>
            <Skeleton width="100%" height={80} style={styles.skeletonCard} />
            <Skeleton width="100%" height={80} style={styles.skeletonCard} />
            <Skeleton width="100%" height={80} style={styles.skeletonCard} />
          </View>
        ) : recent.length === 0 ? (
          <EmptyState icon="video-outline" title="No posts yet" message="Your published videos and their status on each platform will show up here." />
        ) : (
          <View style={styles.section}>
            {recent.map((post, index) => (
              <Animated.View key={post.id} entering={reducedMotion ? undefined : FadeInDown.delay(index * 40).duration(350).springify().damping(18)}>
                <RecentPostCard post={post} onPress={() => router.push(`/posts/${post.id}`)} />
              </Animated.View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsRow: { flexDirection: 'row', gap: 12 },
  skeletonWrap: { gap: 16 },
  skeletonGap: { marginTop: 8 },
  skeletonCard: { borderRadius: radius.lg },
  skeletonTile: { flex: 1, borderRadius: radius.lg },
});
