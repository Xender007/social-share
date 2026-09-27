import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { BrandLoader } from '@/components/brand/brand-loader';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { Button, type IconName } from './button';
import { Text } from './text';

type Tone = 'info' | 'success' | 'warning' | 'error';

export function Banner({ tone = 'info', title, message, action }: { tone?: Tone; title?: string; message: string; action?: ReactNode }) {
  const { colors } = useTheme();
  const map = {
    info: { bg: colors.primaryContainer, fg: 'onPrimaryContainer' as const, icon: 'information-outline' as IconName },
    success: { bg: colors.successContainer, fg: 'onSuccessContainer' as const, icon: 'check-circle-outline' as IconName },
    warning: { bg: colors.warningContainer, fg: 'onWarningContainer' as const, icon: 'alert-outline' as IconName },
    error: { bg: colors.errorContainer, fg: 'onErrorContainer' as const, icon: 'alert-circle-outline' as IconName },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg }]} accessibilityRole="alert">
      <MaterialCommunityIcons name={map.icon} size={22} color={colors[map.fg]} />
      <View style={styles.bannerText}>
        {title ? (
          <Text role="titleSmall" color={map.fg}>
            {title}
          </Text>
        ) : null}
        <Text role="bodyMedium" color={map.fg}>
          {message}
        </Text>
        {action}
      </View>
    </View>
  );
}

/** Shared "icon in a tinted circle + title + body + optional action" layout for empty/error states. */
function IconBlock({ icon, iconBg, iconFg, title, message, action }: { icon: IconName; iconBg: string; iconFg: string; title: string; message: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={icon} size={32} color={iconFg} />
      </View>
      <Text role="titleMedium" align="center">
        {title}
      </Text>
      <Text role="bodyMedium" color="onSurfaceVariant" align="center">
        {message}
      </Text>
      {action}
    </View>
  );
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: { icon: IconName; title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <IconBlock
      icon={icon}
      iconBg={colors.primaryContainer}
      iconFg={colors.onPrimaryContainer}
      title={title}
      message={message}
      action={actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="tonal" /> : undefined}
    />
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.loading} accessibilityLabel={label}>
      <BrandLoader size={48} label={label} />
    </View>
  );
}

export function ErrorState({ message, onRetry, actionLabel = 'Try again', actionIcon = 'refresh' }: { message: string; onRetry?: () => void; actionLabel?: string; actionIcon?: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={styles.errorWrap} accessibilityRole="alert">
      <IconBlock
        icon="alert-circle-outline"
        iconBg={colors.errorContainer}
        iconFg={colors.onErrorContainer}
        title="Something went wrong"
        message={message}
        action={onRetry ? <Button label={actionLabel} variant="tonal" icon={actionIcon} onPress={onRetry} /> : undefined}
      />
    </View>
  );
}

export function ProgressBar({ progress, label }: { progress: number; label?: string }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }} accessibilityLabel={label}>
      <View style={[styles.track, { backgroundColor: colors.secondaryContainer }]}>
        <View style={[styles.bar, { width: `${pct * 100}%`, backgroundColor: colors.primary }]} />
      </View>
    </View>
  );
}

/** Shimmering placeholder block for loading lists/cards. Reduced motion shows a static tint instead of looping. */
export function Skeleton({ width = '100%', height = 16, style }: { width?: number | `${number}%`; height?: number; style?: object }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 0.5 : 0.35);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 0.5;
      return;
    }
    opacity.value = withRepeat(withTiming(0.75, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.outlineVariant }, animatedStyle, style]}
    />
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 12, alignItems: 'flex-start' },
  bannerText: { flex: 1, gap: 4 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 48 },
  errorWrap: { paddingVertical: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
});
