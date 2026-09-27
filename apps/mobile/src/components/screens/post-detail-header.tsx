import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { PostStatus } from '@sp/contracts';
import { StyleSheet, View } from 'react-native';
import { PostStatusPill } from '@/components/platform';
import { Card } from '@/components/ui/card';
import { GradientFill } from '@/components/ui/gradient';
import { Text } from '@/components/ui/text';
import { radius } from '@/theme/tokens';

export interface PostDetailHeaderProps {
  status: PostStatus;
  title: string;
  caption: string | null;
  createdAt: string;
  published: number;
  total: number;
}

/** Header card: gradient video thumbnail placeholder, title, caption, created time and overall status. */
export function PostDetailHeader({ status, title, caption, createdAt, published, total }: PostDetailHeaderProps) {
  return (
    <Card variant="outlined" style={styles.card}>
      <View style={styles.thumb}>
        <GradientFill borderRadius={radius.md} />
        <View style={styles.playCircle}>
          <MaterialCommunityIcons name="play" size={26} color="#FFFFFF" style={styles.playIcon} />
        </View>
      </View>
      <View style={styles.body}>
        <PostStatusPill status={status} />
        <Text role="headlineSmall" accessibilityRole="header">
          {title}
        </Text>
        {caption ? (
          <Text role="bodyMedium" color="onSurfaceVariant" numberOfLines={4}>
            {caption}
          </Text>
        ) : null}
        <Text role="bodySmall" color="onSurfaceVariant">
          {published} of {total} published · {new Date(createdAt).toLocaleString()}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  thumb: { height: 160, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { marginLeft: 3 },
  body: { gap: 6 },
});
