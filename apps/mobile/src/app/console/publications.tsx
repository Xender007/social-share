import type { PublicationStatus } from '@sp/contracts';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { PlatformLabel, PublicationStatusPill } from '@/components/platform';
import { formatRelativeTime, TimelineRow, type TimelineDotTone } from '@/components/screens/timeline';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';

/** Dot colour + icon per publication status, matching the tones used by PublicationStatusPill. */
const DOT_TONE: Record<PublicationStatus, TimelineDotTone> = {
  PENDING_MEDIA: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'progress-clock' },
  QUEUED: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'clock-outline' },
  IN_PROGRESS: { bg: 'primaryContainer', fg: 'onPrimaryContainer', icon: 'progress-upload' },
  WAITING_PROVIDER: { bg: 'primaryContainer', fg: 'onPrimaryContainer', icon: 'timer-sand' },
  RETRY_SCHEDULED: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'refresh' },
  UNKNOWN_OUTCOME: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'help-circle-outline' },
  NEEDS_USER_ACTION: { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'alert-circle-outline' },
  PAUSED: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'pause-circle-outline' },
  PUBLISHED: { bg: 'successContainer', fg: 'onSuccessContainer', icon: 'check-circle' },
  FAILED_FINAL: { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'close-circle-outline' },
  CANCELLED: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'cancel' },
};

export default function PublishingQueueScreen() {
  const query = useQuery({ queryKey: ['admin', 'publications'], queryFn: api.admin.publications, refetchInterval: 5000 });
  if (query.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (query.error) return <Screen underHeader><ErrorState message={(query.error as Error).message} onRetry={query.refetch} /></Screen>;
  const items = query.data ?? [];

  return (
    <Screen underHeader refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      {items.length === 0 ? (
        <EmptyState icon="check-all" title="Queue is clear" message="Nothing is publishing or waiting for attention." />
      ) : (
        items.map((pub, index) => (
          <TimelineRow key={pub.id} tone={DOT_TONE[pub.status]} last={index === items.length - 1}>
            <Card variant="outlined" onPress={() => router.push(`/posts/${pub.postId}`)} accessibilityLabel={`${pub.platformName} ${pub.status}`} style={styles.card}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <PlatformLabel platform={pub.platform} name={pub.postTitle ?? 'Untitled'} detail={`${pub.platformName} · ${pub.accountName}`} />
                </View>
                <PublicationStatusPill status={pub.status} />
              </View>
              {pub.error?.message ? (
                <Text role="bodySmall" color="error">
                  {pub.error.code}: {pub.error.message}
                </Text>
              ) : null}
              <Text role="bodySmall" color="onSurfaceVariant">
                Attempt {pub.attemptCount}
                {pub.step ? ` · ${pub.step}` : ''} · updated {formatRelativeTime(pub.updatedAt)}
              </Text>
            </Card>
          </TimelineRow>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
