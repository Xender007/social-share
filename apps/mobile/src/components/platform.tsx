import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { PostStatus, PublicationStatus } from '@sp/contracts';
import { StyleSheet, View } from 'react-native';
import { platformBrand, radius, type ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import type { IconName } from './ui/button';
import { Text } from './ui/text';

/** Brand icon on a soft tinted circle (12% opacity of the platform colour) so it reads at a glance. */
export function PlatformIcon({ platform, size = 20 }: { platform: string; size?: number }) {
  const brand = platformBrand[platform];
  const color = brand?.color ?? '#64748B';
  const circle = size * 1.8;
  return (
    <View
      style={[styles.iconCircle, { width: circle, height: circle, borderRadius: circle / 2, backgroundColor: `${color}1F` }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <MaterialCommunityIcons name={(brand?.icon ?? 'web') as IconName} size={size} color={color} />
    </View>
  );
}

export function PlatformLabel({ platform, name, detail }: { platform: string; name?: string; detail?: string | null }) {
  return (
    <View style={styles.platformRow}>
      <PlatformIcon platform={platform} size={22} />
      <View style={styles.platformText}>
        <Text role="titleSmall">{name ?? platformBrand[platform]?.name ?? platform}</Text>
        {detail ? (
          <Text role="bodySmall" color="onSurfaceVariant" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type Tone = { bg: keyof ColorScheme; fg: keyof ColorScheme; icon: IconName; label: string };

const PUBLICATION_TONES: Record<PublicationStatus, Tone> = {
  PENDING_MEDIA: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'progress-clock', label: 'Preparing video' },
  QUEUED: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'clock-outline', label: 'Queued' },
  IN_PROGRESS: { bg: 'primaryContainer', fg: 'onPrimaryContainer', icon: 'progress-upload', label: 'Publishing' },
  WAITING_PROVIDER: { bg: 'primaryContainer', fg: 'onPrimaryContainer', icon: 'timer-sand', label: 'Processing' },
  RETRY_SCHEDULED: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'refresh', label: 'Retrying soon' },
  UNKNOWN_OUTCOME: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'help-circle-outline', label: 'Checking' },
  NEEDS_USER_ACTION: { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'alert-circle-outline', label: 'Needs attention' },
  PAUSED: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'pause-circle-outline', label: 'Paused' },
  PUBLISHED: { bg: 'successContainer', fg: 'onSuccessContainer', icon: 'check-circle', label: 'Published' },
  FAILED_FINAL: { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'close-circle-outline', label: 'Failed' },
  CANCELLED: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'cancel', label: 'Cancelled' },
};

const POST_TONES: Record<PostStatus, Tone> = {
  SCHEDULED: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'calendar-clock', label: 'Scheduled' },
  PUBLISHING: { bg: 'primaryContainer', fg: 'onPrimaryContainer', icon: 'progress-upload', label: 'Publishing' },
  PUBLISHED: { bg: 'successContainer', fg: 'onSuccessContainer', icon: 'check-circle', label: 'Published' },
  PARTIALLY_PUBLISHED: { bg: 'warningContainer', fg: 'onWarningContainer', icon: 'check-circle-outline', label: 'Partly published' },
  NEEDS_ATTENTION: { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'alert-circle-outline', label: 'Needs attention' },
  FAILED: { bg: 'errorContainer', fg: 'onErrorContainer', icon: 'close-circle-outline', label: 'Failed' },
  CANCELLED: { bg: 'secondaryContainer', fg: 'onSecondaryContainer', icon: 'cancel', label: 'Cancelled' },
};

function Pill({ tone }: { tone: Tone }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors[tone.bg] }]} accessibilityLabel={tone.label}>
      <MaterialCommunityIcons name={tone.icon} size={14} color={colors[tone.fg]} />
      <Text role="labelMedium" color={tone.fg}>
        {tone.label}
      </Text>
    </View>
  );
}

export const PublicationStatusPill = ({ status }: { status: PublicationStatus }) => <Pill tone={PUBLICATION_TONES[status]} />;
export const PostStatusPill = ({ status }: { status: PostStatus }) => <Pill tone={POST_TONES[status]} />;

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <Text
      role="labelLarge"
      color={selected ? 'onPrimaryContainer' : 'onSurfaceVariant'}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      suppressHighlighting
      style={[styles.chip, { backgroundColor: selected ? colors.primaryContainer : 'transparent', borderColor: selected ? 'transparent' : colors.outlineVariant }]}>
      {icon ? `${selected ? '✓ ' : ''}` : ''}
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  platformRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  platformText: { flexShrink: 1 },
  iconCircle: { alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, alignSelf: 'flex-start' },
  chip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36, overflow: 'hidden', textAlignVertical: 'center' },
});
