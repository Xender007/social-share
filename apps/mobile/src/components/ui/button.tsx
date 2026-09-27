import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { brand, motion, radius, touchTarget } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { GradientFill } from './gradient';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
  /** 'md' (default): 52dp filled / 48dp others. 'lg': 56dp for hero CTAs. */
  size?: 'md' | 'lg';
  /** 'onGradient': for buttons placed on a brand-gradient surface (white fill / white outline / white text). */
  tone?: 'default' | 'onGradient';
}

/**
 * Primary fill: a calm indigo -> violet two-tone (Aurora Night), not the 3-colour brand gradient,
 * which stays reserved for the logo, hero cards and accents.
 */
const PRIMARY_FILL = ['#5B5FEF', '#7C6CF6', brand.mid, '#7C6CF6', '#5B5FEF'] as const;
/** Light-variant press tint (indigo @ 14%). */
const PRESS_TINT = alpha(brand.start, 0.14);
const WHITE = '#FFFFFF';
const SHINE_W = 44;

/** Hex (#RRGGBB) + alpha -> rgba(). */
function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function iconMotion(icon: IconName | undefined): 'slide' | 'spin' | 'pop' {
  if (!icon) return 'pop';
  if (/arrow|chevron|send|share|upload|export|login|logout|open-in-new/.test(icon)) return 'slide';
  if (/plus|refresh|reload|sync|autorenew|cog/.test(icon)) return 'spin';
  return 'pop';
}

/**
 * Rounded-rect button (radius md = 14), 48dp min touch target.
 * Filled: a living indigo -> violet fill (slow drift), a soft shine sweep, a small indigo glow that grows on press,
 * and a 3-dot wave while loading. Other variants are quiet glass / hairline / text styles with press scale only.
 */
export function Button({
  label,
  onPress,
  variant = 'filled',
  icon,
  loading = false,
  disabled = false,
  fullWidth,
  accessibilityHint,
  testID,
  size = 'md',
  tone = 'default',
}: ButtonProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const onGradient = tone === 'onGradient';
  const inactive = disabled || loading;
  const isPrimary = variant === 'filled' && !disabled && !onGradient;
  const live = isPrimary && !reducedMotion;

  const press = useSharedValue(0);
  const drift = useSharedValue(0);
  const shine = useSharedValue(0);
  const loadingSV = useSharedValue(loading ? 1 : 0);
  const dots = useSharedValue(0);

  // ---- colours per variant (dark-first UI) ----
  let bg = 'transparent';
  let fg: string = colors.primary;
  let border: string | undefined;
  let pressTint = alpha(colors.primary, 0.1);
  if (variant === 'filled') {
    bg = onGradient ? WHITE : colors.primaryContainer;
    fg = onGradient ? '#4338CA' : WHITE;
    pressTint = onGradient ? PRESS_TINT : 'rgba(255,255,255,0.12)';
  } else if (variant === 'tonal') {
    bg = onGradient ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
    border = onGradient ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)';
    fg = onGradient ? WHITE : colors.primary;
    pressTint = onGradient ? 'rgba(255,255,255,0.14)' : PRESS_TINT;
  } else if (variant === 'outlined') {
    border = onGradient ? 'rgba(255,255,255,0.7)' : alpha(colors.primary, 0.5);
    fg = onGradient ? WHITE : colors.primary;
    pressTint = onGradient ? 'rgba(255,255,255,0.14)' : PRESS_TINT;
  } else if (variant === 'text') {
    fg = onGradient ? WHITE : colors.primary;
    pressTint = onGradient ? 'rgba(255,255,255,0.12)' : PRESS_TINT;
  } else if (variant === 'danger') {
    bg = alpha(colors.error, 0.12);
    border = alpha(colors.error, 0.28);
    fg = colors.error;
    pressTint = alpha(colors.error, 0.12);
  }
  if (disabled) {
    bg = variant === 'text' ? 'transparent' : colors.surfaceContainerHigh;
    border = undefined;
    fg = colors.onSurfaceVariant;
  }

  const height = size === 'lg' ? 56 : variant === 'filled' ? 52 : touchTarget;

  // ---- loops: drift + shine (filled/primary only, UI thread, transform/opacity only) ----
  useEffect(() => {
    if (!live) return;
    const half = loading ? 1600 : 4000;
    drift.value = withRepeat(withTiming(1, { duration: half, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(drift);
  }, [live, loading, drift]);

  useEffect(() => {
    if (!live || loading) return;
    shine.value = 0;
    shine.value = shineLoop(false);
    return () => cancelAnimation(shine);
  }, [live, loading, shine]);

  useEffect(() => {
    loadingSV.value = withTiming(loading ? 1 : 0, { duration: motion.fast });
    if (!loading || reducedMotion) return;
    dots.value = 0;
    dots.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(dots);
  }, [loading, reducedMotion, dots, loadingSV]);

  // ---- animated styles ----
  // Percent translates are relative to the element's own box, so no onLayout/width state is needed.
  // Drift layer is 200% wide: -17.5% of it = 35% of the button width.
  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: `${-drift.value * 17.5}%` }] }));
  // Shine track is button-sized with the streak centred: -75%..+75% sweeps the streak fully across.
  const shineStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + press.value * 0.12,
    transform: [{ translateX: `${-75 + shine.value * 150}%` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + press.value * 0.45,
    transform: [{ translateY: press.value * 2 }],
  }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: press.value }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - loadingSV.value }));
  const dotsStyle = useAnimatedStyle(() => ({ opacity: loadingSV.value }));
  const kind = iconMotion(icon);
  const iconStyle = useAnimatedStyle(() => {
    const p = press.value;
    if (kind === 'slide') return { transform: [{ translateX: p * 2 }] };
    if (kind === 'spin') return { transform: [{ rotate: `${p * 90}deg` }] };
    return { transform: [{ scale: 1 + p * 0.08 }] };
  });

  const handlePressIn = () => {
    press.value = withSpring(1, motion.spring);
    if (live) {
      // Immediate sweep on press, then fall back into the idle loop.
      shine.value = 0;
      shine.value = withSequence(withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }), shineLoop(true));
    }
  };
  const handlePressOut = () => {
    press.value = withSpring(0, motion.spring);
  };

  const radiusStyle = { borderRadius: radius.md };

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={inactive}
      pressedScale={0.96}
      haptic={variant === 'filled' || variant === 'danger'}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[styles.base, radiusStyle, { minHeight: height }, variant === 'text' && styles.textVariant, fullWidth && styles.full]}>
      {/* Soft indigo glow under the primary button (outside the clip so it can spill). */}
      {isPrimary ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, radiusStyle, styles.glow, glowStyle]} /> : null}

      {/* Clipped background stack: fill, drift, shine, top highlight, press tint. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          radiusStyle,
          styles.clip,
          { backgroundColor: bg, borderColor: border ?? 'transparent', borderWidth: border ? (variant === 'outlined' ? 1 : StyleSheet.hairlineWidth) : 0 },
        ]}>
        {isPrimary ? (
          <>
            <Animated.View style={[styles.driftLayer]}>
              <GradientFill colors={PRIMARY_FILL} angle={110} />
            </Animated.View>
            {live ? (
              <Animated.View style={[StyleSheet.absoluteFill, shineStyle]}>
                <View style={[styles.shine, { height: height * 2, top: -height / 2 }]}>
                  <GradientFill colors={[WHITE, WHITE, WHITE]} opacities={[0, 1, 0]} angle={90} />
                </View>
              </Animated.View>
            ) : null}
            {/* 1px inner top highlight for a soft glassy lift. */}
            <View style={[styles.topHighlight, radiusStyle]} />
          </>
        ) : null}
        {!disabled ? <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: pressTint }, tintStyle]} /> : null}
      </View>

      <View style={styles.row}>
        <Animated.View style={[styles.row, labelStyle]}>
          {icon ? (
            <Animated.View style={iconStyle}>
              <MaterialCommunityIcons name={icon} size={18} color={fg} />
            </Animated.View>
          ) : null}
          <Text role="labelLarge" numberOfLines={1} style={[styles.label, { color: fg }]}>
            {label}
          </Text>
        </Animated.View>
        {loading ? (
          <Animated.View style={[styles.dots, dotsStyle]}>
            {reducedMotion ? <ActivityIndicator size="small" color={fg} /> : [0, 1, 2].map((i) => <Dot key={i} index={i} t={dots} color={fg} />)}
          </Animated.View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Idle shine: wait ~4s, sweep for 1.1s, repeat forever (restarts from 0 each iteration). */
function shineLoop(fromPress: boolean) {
  const loop = withRepeat(withDelay(4000, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) })), -1, false);
  return fromPress ? withSequence(withTiming(0, { duration: 0 }), loop) : loop;
}

function Dot({ index, t, color }: { index: number; t: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const phase = (t.value - index * 0.16 + 1) % 1;
    const lift = phase < 0.5 ? Math.sin(phase * 2 * Math.PI) : 0;
    return { opacity: 0.5 + lift * 0.5, transform: [{ translateY: -lift * 5 }] };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: 20, justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
  textVariant: { paddingHorizontal: 12 },
  clip: { overflow: 'hidden' },
  glow: { backgroundColor: brand.start, boxShadow: `0px 6px 16px 0px ${alpha(brand.start, 0.3)}` },
  driftLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '200%' },
  shine: { position: 'absolute', left: '50%', marginLeft: -SHINE_W / 2, width: SHINE_W, transform: [{ skewX: '-20deg' }] },
  topHighlight: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontSize: 15, lineHeight: 20, letterSpacing: 0.2 },
  dots: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
