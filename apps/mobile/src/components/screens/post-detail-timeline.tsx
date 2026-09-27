import type { PublicationAction, PublicationStatus, PublicationView } from '@sp/contracts';
import { StyleSheet, View } from 'react-native';
import { PlatformLabel, PublicationStatusPill } from '@/components/platform';
import { Button, type IconName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import type { ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const TONE_BY_STATUS: Record<PublicationStatus, keyof ColorScheme> = {
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

export interface ActionMeta {
  label: string;
  icon: IconName;
  variant: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
}

export interface PublicationTimelineProps {
  publications: PublicationView[];
  stepLabels: Record<string, string>;
  actionMeta: Record<PublicationAction, ActionMeta>;
  busy: boolean;
  onAction: (pub: PublicationView, action: PublicationAction) => void;
}

function TimelineDot({ status, isLast }: { status: PublicationStatus; isLast: boolean }) {
  const { colors } = useTheme();
  const tone = colors[TONE_BY_STATUS[status]];
  return (
    <View style={styles.dotColumn}>
      <View style={[styles.dot, { backgroundColor: tone, borderColor: tone }]} />
      {isLast ? null : <View style={[styles.line, { backgroundColor: colors.outlineVariant }]} />}
    </View>
  );
}

function PublicationRow({ pub, stepLabels, actionMeta, busy, onAction, isLast }: { pub: PublicationView; stepLabels: Record<string, string>; actionMeta: Record<PublicationAction, ActionMeta>; busy: boolean; onAction: (action: PublicationAction) => void; isLast: boolean }) {
  const active = pub.status === 'IN_PROGRESS' || pub.status === 'WAITING_PROVIDER';
  return (
    <View style={styles.row}>
      <TimelineDot status={pub.status} isLast={isLast} />
      <Card variant="outlined" style={styles.pubCard} testID={`publication-${pub.platform}`}>
        <View style={styles.pubTop}>
          <View style={styles.flex}>
            <PlatformLabel platform={pub.platform} name={pub.platformName} detail={pub.accountName} />
          </View>
          <PublicationStatusPill status={pub.status} />
        </View>
        {active ? (
          <View style={styles.progress}>
            <Text role="bodySmall" color="onSurfaceVariant">
              {pub.step ? (stepLabels[pub.step] ?? 'Working…') : 'Working…'}
            </Text>
            <ProgressBar progress={pub.status === 'WAITING_PROVIDER' ? 0.7 : 0.4} label={`${pub.platformName} progress`} />
          </View>
        ) : null}
        {pub.status === 'RETRY_SCHEDULED' && pub.nextAttemptAt ? (
          <Text role="bodySmall" color="onSurfaceVariant">
            Next try around {new Date(pub.nextAttemptAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </Text>
        ) : null}
        {pub.error?.message ? (
          <Text role="bodyMedium" color={pub.status === 'NEEDS_USER_ACTION' || pub.status === 'FAILED_FINAL' ? 'error' : 'onSurfaceVariant'}>
            {pub.error.message}
          </Text>
        ) : null}
        {pub.attemptCount > 0 ? (
          <Text role="bodySmall" color="onSurfaceVariant">
            {pub.attemptCount} attempt{pub.attemptCount === 1 ? '' : 's'}
          </Text>
        ) : null}
        {pub.actions.length > 0 ? (
          <View style={styles.actions}>
            {pub.actions.map((action) => (
              <Button key={action} testID={`action-${pub.platform}-${action}`} label={actionMeta[action].label} icon={actionMeta[action].icon} variant={actionMeta[action].variant} onPress={() => onAction(action)} disabled={busy} />
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/** Vertical timeline of per-platform publications: a status-coloured dot + connecting line, next to the card. */
export function PublicationTimeline({ publications, stepLabels, actionMeta, busy, onAction }: PublicationTimelineProps) {
  return (
    <View>
      {publications.map((pub, i) => (
        <PublicationRow key={pub.id} pub={pub} stepLabels={stepLabels} actionMeta={actionMeta} busy={busy} onAction={(action) => onAction(pub, action)} isLast={i === publications.length - 1} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  dotColumn: { alignItems: 'center', width: 16, paddingTop: 6 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  line: { flex: 1, width: 2, marginTop: 4, marginBottom: 4, minHeight: 24 },
  pubCard: { flex: 1, gap: 10, marginBottom: 16 },
  pubTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progress: { gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
