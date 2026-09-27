import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { PostView } from '@sp/contracts';
import { StyleSheet, View } from 'react-native';
import { PlatformIcon, PostStatusPill } from '@/components/platform';
import { Card } from '@/components/ui/card';
import { GradientFill } from '@/components/ui/gradient';
import { Text } from '@/components/ui/text';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * Recent post row: gradient placeholder thumbnail (no thumbnail URL exists in `PostView` yet, so
 * this is always the play-icon placeholder), title, per-platform status icons, status pill, time.
 */
export function RecentPostCard({ post, onPress }: { post: PostView; onPress: () => void }) {
  const { colors } = useTheme();
  const title = post.title || post.caption?.split('\n')[0] || post.media.originalFilename || 'Untitled video';

  return (
    <Card variant="outlined" onPress={onPress} accessibilityLabel={`Post ${title}`} style={styles.card}>
      <View style={styles.row}>
        <View style={styles.thumb}>
          <GradientFill borderRadius={radius.sm} />
          <MaterialCommunityIcons name="play" size={20} color="#FFFFFF" style={styles.playIcon} />
        </View>
        <View style={styles.body}>
          <View style={styles.top}>
            <Text role="titleSmall" numberOfLines={1} style={styles.flex}>
              {title}
            </Text>
            <PostStatusPill status={post.status} />
          </View>
          <View style={styles.platformIcons}>
            {post.publications.map((pub) => (
              <View key={pub.id} style={styles.platformIcon} accessibilityLabel={`${pub.platformName}: ${pub.status.toLowerCase().replace(/_/g, ' ')}`}>
                <PlatformIcon platform={pub.platform} size={14} />
                <MaterialCommunityIcons
                  name={pub.status === 'PUBLISHED' ? 'check' : pub.status === 'NEEDS_USER_ACTION' || pub.status === 'FAILED_FINAL' ? 'alert' : 'dots-horizontal'}
                  size={12}
                  color={pub.status === 'PUBLISHED' ? colors.success : pub.status === 'NEEDS_USER_ACTION' || pub.status === 'FAILED_FINAL' ? colors.error : colors.onSurfaceVariant}
                />
              </View>
            ))}
            <Text role="bodySmall" color="onSurfaceVariant" style={styles.date}>
              {new Date(post.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12 },
  row: { flexDirection: 'row', gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playIcon: { marginLeft: 2 },
  body: { flex: 1, gap: 8, justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  platformIcons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  platformIcon: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  date: { marginLeft: 'auto' },
});
