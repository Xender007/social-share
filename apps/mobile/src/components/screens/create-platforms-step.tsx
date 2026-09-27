import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { CapabilityAccountView, CapabilityPlatformView, PublishOptionField } from '@sp/contracts';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Chip, PlatformIcon, PlatformLabel } from '@/components/platform';
import { Banner } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Toggle } from '@/components/ui/toggle';
import type { DestinationDraft } from '@/stores/draft';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export interface Destination {
  platform: CapabilityPlatformView;
  account: CapabilityAccountView;
}

function OptionControl({ field, value, onChange }: { field: PublishOptionField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === 'boolean') {
    return (
      <View style={styles.optionRow}>
        <Text role="bodyMedium" style={styles.flex}>
          {field.label}
          {field.required ? ' *' : ''}
        </Text>
        <Toggle value={Boolean(value)} onValueChange={onChange} accessibilityLabel={field.label} />
      </View>
    );
  }
  if (field.type === 'enum') {
    return (
      <View style={styles.optionBlock}>
        <Text role="labelMedium" color="onSurfaceVariant">
          {field.label}
        </Text>
        <View style={styles.chips}>
          {field.values.map((v, i) => (
            <Chip key={v} label={field.valueLabels?.[i] ?? v} selected={value === v} onPress={() => onChange(v)} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <TextField
      label={field.label}
      keyboardType="number-pad"
      value={value === undefined ? '' : String(value)}
      onChangeText={(t) => onChange(t === '' ? undefined : Number(t.replace(/\D/g, '')))}
    />
  );
}

/** Selection check indicator: filled gradient + check icon when selected, outline circle otherwise (never colour-only). */
function SelectIndicator({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const content = selected ? (
    <View style={styles.indicator}>
      <GradientFill borderRadius={999} />
      <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
    </View>
  ) : (
    <View style={[styles.indicator, { borderColor: colors.outline, borderWidth: 2 }]} />
  );
  if (!selected || reducedMotion) return content;
  return <Animated.View entering={FadeIn.duration(150)}>{content}</Animated.View>;
}

function PlatformCard({
  destination,
  draft,
  issue,
  isOpen,
  onToggleSelected,
  onToggleExpanded,
}: {
  destination: Destination;
  draft: DestinationDraft;
  issue: string | null;
  isOpen: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
}) {
  const { colors } = useTheme();
  const { platform, account } = destination;
  const selected = draft.selected;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceContainerLow,
          borderColor: selected ? colors.primary : colors.outlineVariant,
          borderWidth: selected ? 2 : 1,
        },
      ]}>
      <PressableScale
        onPress={onToggleSelected}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${platform.name}, ${account.handle ?? account.displayName}`}
        style={styles.cardRow}>
        <PlatformIcon platform={platform.code} size={26} />
        <View style={styles.flex}>
          <PlatformLabel platform={platform.code} name={platform.name} detail={account.handle ?? account.displayName} />
        </View>
        <SelectIndicator selected={selected} />
      </PressableScale>

      {issue ? (
        <Text role="bodySmall" color="error" style={styles.issue}>
          {issue}
        </Text>
      ) : null}

      {selected ? (
        <PressableScale onPress={onToggleExpanded} accessibilityRole="button" accessibilityLabel={isOpen ? `Close ${platform.name} customization` : `Customize ${platform.name}`} style={styles.expandRow}>
          <Text role="labelLarge" color="primary">
            {isOpen ? 'Done customizing' : 'Customize for ' + platform.name}
          </Text>
          <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
        </PressableScale>
      ) : null}

    </View>
  );
}

export interface PlatformsStepProps {
  destinations: Destination[];
  drafts: Record<string, DestinationDraft>;
  unconnected: CapabilityPlatformView[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onToggleSelected: (accountId: string) => void;
  onOptionChange: (accountId: string, field: PublishOptionField, value: unknown) => void;
  onOverrideChange: (accountId: string, patch: { titleOverride?: string; captionOverride?: string }) => void;
  durationIssue: (platform: CapabilityPlatformView) => string | null;
  perAccountError?: Record<string, string>;
  noTargets: boolean;
}

/** Selectable platform cards + per-platform customize, expandable. */
export function PlatformsStep({
  destinations,
  drafts,
  unconnected,
  expanded,
  setExpanded,
  onToggleSelected,
  onOptionChange,
  onOverrideChange,
  durationIssue,
  perAccountError,
  noTargets,
}: PlatformsStepProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {destinations.map(({ platform, account }) => {
        const d = drafts[account.id] ?? { selected: false, options: {} };
        const issue = durationIssue(platform) ?? perAccountError?.[account.id] ?? null;
        const isOpen = expanded === account.id;
        return (
          <View key={account.id}>
            <PlatformCard
              destination={{ platform, account }}
              draft={d}
              issue={issue}
              isOpen={isOpen}
              onToggleSelected={() => onToggleSelected(account.id)}
              onToggleExpanded={() => setExpanded(isOpen ? null : account.id)}
            />
            {d.selected && isOpen ? (
              <View style={[styles.customizeFields, { backgroundColor: colors.surfaceContainer, borderRadius: radius.md }]}>
                {platform.publish.limits.titleMaxChars ? (
                  <TextField
                    label={`${platform.name} title (optional)`}
                    value={d.titleOverride ?? ''}
                    onChangeText={(t) => onOverrideChange(account.id, { titleOverride: t })}
                    maxLength={platform.publish.limits.titleMaxChars}
                    showCounter
                  />
                ) : null}
                <TextField
                  label={`${platform.name} caption (optional)`}
                  helper="Leave empty to use the shared caption."
                  value={d.captionOverride ?? ''}
                  onChangeText={(t) => onOverrideChange(account.id, { captionOverride: t })}
                  multiline
                  maxLength={platform.publish.limits.captionMaxChars}
                  showCounter
                />
                {platform.publish.options.map((field) => (
                  <OptionControl key={field.key} field={field} value={d.options[field.key]} onChange={(v) => onOptionChange(account.id, field, v)} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {unconnected.map((platform) => (
        <PressableScale
          key={platform.code}
          onPress={() => router.push('/connections')}
          accessibilityRole="button"
          accessibilityLabel={`Connect ${platform.name}`}
          style={[styles.card, styles.cardRow, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, borderWidth: 1 }]}>
          <MaterialCommunityIcons name="link-variant-plus" size={24} color={colors.primary} />
          <PlatformLabel platform={platform.code} name={platform.name} detail={platform.connection.status === 'REAUTH_REQUIRED' ? 'Reconnect to publish' : 'Connect to publish'} />
        </PressableScale>
      ))}
      {noTargets ? <Banner tone="warning" message="Publishing isn't available on your account right now." /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: 12 },
  card: { borderRadius: radius.lg, padding: 14, gap: 4 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56 },
  issue: { marginLeft: 40 },
  expandRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingLeft: 40 },
  customizeFields: { gap: 12, padding: 14, marginTop: -4 },
  indicator: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  optionBlock: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
