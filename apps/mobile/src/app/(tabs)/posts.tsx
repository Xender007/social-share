import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PlatformStatusIcon } from '@/components/screens/posts-platform-status';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostStatusPill } from '@/components/platform';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { useTheme } from '@/theme/use-theme';

const STAGGER_MS = 40;
const STAGGER_CAP = 8;

/** Compact "just now / 5m / 3h / 2d" relative time so post cards stay scannable in a dense list. */
function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function PostsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const query = useInfiniteQuery({
    queryKey: ['posts', 'all'],
    queryFn: ({ pageParam }) => api.posts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Text role="headlineMedium" accessibilityRole="header">
        Posts
      </Text>
      <Button label="New" icon="plus" variant="tonal" onPress={() => router.push('/create')} />
    </View>
  );

  if (query.isLoading) return <View style={[styles.root, { backgroundColor: colors.surface }]}>{header}<LoadingState /></View>;
  if (query.error) return <View style={[styles.root, { backgroundColor: colors.surface }]}>{header}<View style={styles.pad}><ErrorState message={(query.error as Error).message} onRetry={query.refetch} /></View></View>;

  return (
    <FlatList
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
      data={items}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState icon="video-outline" title="No posts yet" message="Create your first post to see its publishing status here." actionLabel="Create post" onAction={() => router.push('/create')} />}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} colors={[colors.primary]} />}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
      onEndReachedThreshold={0.4}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item: post, index }) => {
        const title = post.title || post.caption?.split('\n')[0] || post.media.originalFilename || 'Untitled video';
        const card = (
          <Card variant="outlined" onPress={() => router.push(`/posts/${post.id}`)} accessibilityLabel={`Open post ${title}`}>
            <View style={styles.row}>
              <Text role="titleSmall" numberOfLines={1} style={styles.flex}>
                {title}
              </Text>
              <PostStatusPill status={post.status} />
            </View>
            <View style={[styles.row, styles.meta]}>
              <View style={styles.platformRow}>
                {post.publications.map((pub) => (
                  <PlatformStatusIcon key={pub.id} platform={pub.platform} status={pub.status} />
                ))}
              </View>
              <View style={styles.time}>
                <MaterialCommunityIcons name="clock-outline" size={13} color={colors.onSurfaceVariant} />
                <Text role="bodySmall" color="onSurfaceVariant">
                  {formatRelative(post.createdAt)}
                </Text>
              </View>
            </View>
          </Card>
        );
        if (reducedMotion || index >= STAGGER_CAP) return card;
        return (
          <Animated.View entering={FadeInDown.duration(300).delay(index * STAGGER_MS).withInitialValues({ transform: [{ translateY: 12 }] })}>
            {card}
          </Animated.View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  list: { paddingHorizontal: 16 },
  separator: { height: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { marginTop: 10, justifyContent: 'space-between' },
  platformRow: { flexDirection: 'row', gap: 10 },
  time: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
});
