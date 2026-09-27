import type { PublicationStatus } from '@sp/contracts';
import { StyleSheet, View } from 'react-native';
import { PlatformIcon } from '@/components/platform';
import type { ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const DOT_TONE: Record<PublicationStatus, keyof ColorScheme> = {
  PENDING_MEDIA: 'onSurfaceVariant',
  QUEUED: 'onSurfaceVariant',
  IN_PROGRESS: 'primary',
  WAITING_PROVIDER: 'primary',
  RETRY_SCHEDULED: 'warning',
  UNKNOWN_OUTCOME: 'warning',
  NEEDS_USER_ACTION: 'error',
  PAUSED: 'warning',
  PUBLISHED: 'success',
  FAILED_FINAL: 'error',
  CANCELLED: 'onSurfaceVariant',
};

/** Platform icon with a small status dot overlay, so a post's per-platform outcome reads at a glance. */
export function PlatformStatusIcon({ platform, status }: { platform: string; status: PublicationStatus }) {
  const { colors, dark } = useTheme();
  return (
    <View style={styles.wrap}>
      <PlatformIcon platform={platform} size={20} />
      <View
        style={[
          styles.dot,
          { backgroundColor: colors[DOT_TONE[status]], borderColor: dark ? colors.surfaceContainer : colors.surfaceContainerLow },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  dot: { position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
});
