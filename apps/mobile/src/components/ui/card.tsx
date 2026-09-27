import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { GradientFill } from './gradient';
import { PressableScale } from './pressable-scale';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  /** 'gradient' paints the brand gradient behind children — use `color="onGradient"` (fixed white) for text/icons on it, not `onPrimary`. */
  variant?: 'filled' | 'outlined' | 'elevated' | 'gradient' | 'glass';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Card: lg (20dp) radius. Light mode is a white surface with a soft violet-tinted shadow;
 * dark mode drops the shadow for a 1px outlineVariant border (spec §Shape and elevation).
 */
export function Card({ children, onPress, variant = 'filled', style, accessibilityLabel, testID }: CardProps) {
  const { colors, dark, elevation } = useTheme();

  const isGradient = variant === 'gradient';
  const isGlass = variant === 'glass';
  const isOutlined = variant === 'outlined';

  const surface: StyleProp<ViewStyle> = isGradient
    ? { backgroundColor: 'transparent' }
    : isGlass
      ? {
          backgroundColor: dark ? 'rgba(37,33,54,0.6)' : 'rgba(255,255,255,0.6)',
          borderColor: colors.outlineVariant,
          borderWidth: StyleSheet.hairlineWidth,
        }
      : isOutlined
        ? { backgroundColor: colors.surface, borderColor: colors.outlineVariant, borderWidth: 1 }
        : dark
          ? { backgroundColor: variant === 'elevated' ? colors.surfaceContainerHigh : colors.surfaceContainer, borderColor: colors.outlineVariant, borderWidth: 1 }
          : { backgroundColor: colors.surfaceContainerLow, ...elevation };

  const content = (
    <>
      {isGradient ? <GradientFill borderRadius={radius.lg} /> : null}
      {children}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={[styles.card, surface, style]}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: isGradient ? 'rgba(255,255,255,0.2)' : 'rgba(99,102,241,0.14)' }}
      style={[styles.card, surface, style]}>
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: 16, overflow: 'hidden' },
});
