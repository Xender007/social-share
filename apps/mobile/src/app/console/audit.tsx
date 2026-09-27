import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { formatRelativeTime, TimelineRow, type TimelineDotTone } from '@/components/screens/timeline';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { platformBrand } from '@/theme/tokens';

const summarize = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
};

const onOff = (enabled: unknown) => (enabled === true ? 'turned on' : enabled === false ? 'turned off' : 'changed');

/** Plain-language line for the changes owners make most; other entries fall back to their raw value. */
function describe(action: string, value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const platformName = typeof v.platformName === 'string' ? v.platformName : null;
  const featureName = typeof v.featureName === 'string' ? v.featureName : null;
  switch (action) {
    case 'platform.updated':
      return platformName ? `${platformName} ${onOff(v.enabled)}` : null;
    case 'feature.updated':
      return featureName ? `${featureName} ${onOff(v.enabled)} everywhere` : null;
    case 'platform_feature.updated':
      return featureName && platformName ? `${featureName} on ${platformName} ${onOff(v.enabled)}` : null;
    case 'post.created':
      return Array.isArray(v.destinations)
        ? `Post created for ${v.destinations.map((code) => platformBrand[String(code)]?.name ?? String(code)).join(', ')}`
        : null;
    default:
      return null;
  }
}

/** Dot colour + icon for the timeline rail, grouped by what kind of change the entry represents. */
function toneFor(action: string): TimelineDotTone {
  if (action.startsWith('kill_switch.activated')) return { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'alert-octagon-outline' };
  if (action.startsWith('kill_switch.deactivated')) return { bg: 'successContainer', fg: 'onSuccessContainer', icon: 'play-circle-outline' };
  if (action.endsWith('.created')) return { bg: 'successContainer', fg: 'onSuccessContainer', icon: 'plus-circle-outline' };
  if (action.endsWith('.updated')) return { bg: 'primaryContainer', fg: 'onPrimaryContainer', icon: 'tune-variant' };
  return { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'file-document-outline' };
}

export default function AuditLogScreen() {
  const query = useQuery({ queryKey: ['admin', 'audit'], queryFn: api.admin.auditLogs });
  if (query.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (query.error) return <Screen underHeader><ErrorState message={(query.error as Error).message} onRetry={query.refetch} /></Screen>;
  const items = query.data ?? [];

  return (
    <Screen underHeader refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      {items.length === 0 ? <EmptyState icon="history" title="No changes yet" message="Configuration changes will be listed here." /> : null}
      {items.map((entry, index) => {
        const description = describe(entry.action, entry.newValue);
        return (
          <TimelineRow key={entry.id} tone={toneFor(entry.action)} last={index === items.length - 1}>
            <Card variant="outlined" style={styles.card}>
              <View style={styles.row}>
                <Text role="titleSmall" style={styles.flex}>
                  {description ?? entry.action}
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  {formatRelativeTime(entry.createdAt)}
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                {entry.actorEmail ?? 'system'} · {entry.action}
              </Text>
              {entry.reason ? <Text role="bodyMedium">“{entry.reason}”</Text> : null}
              {!description && entry.newValue ? (
                <Text role="bodySmall" color="onSurfaceVariant" numberOfLines={2}>
                  {summarize(entry.newValue)}
                </Text>
              ) : null}
            </Card>
          </TimelineRow>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
