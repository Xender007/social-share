import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { motion } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends PressableProps {
  children: ReactNode;
  /** Fire `Haptics.selectionAsync()` on press-in. Defaults to false; buttons opt in explicitly. */
  haptic?: boolean;
  /** Scale to animate to on press. Defaults to 0.97 per the Broadcast spec. */
  pressedScale?: number;
}

/**
 * Pressable with a UI-thread spring scale on press (0.97 default); under `useReducedMotion()` the scale is a short timing instead.
 * Accessibility props (accessibilityRole, accessibilityLabel, accessibilityState, ...) pass straight through.
 */
export function PressableScale({ children, haptic, pressedScale = 0.97, onPressIn, onPressOut, style, ...rest }: PressableScaleProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Reduced motion keeps the (small, informative) press scale but swaps the spring for a short, non-bouncy timing.
  const to = (v: number) => (reducedMotion ? withTiming(v, { duration: motion.fast }) : withSpring(v, motion.spring));

  const handlePressIn = (e: GestureResponderEvent) => {
    scale.value = to(pressedScale);
    if (haptic) void Haptics.selectionAsync();
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    scale.value = to(1);
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      // Android sometimes "flattens" small animated views for perf and leaves a stale composited
      // bitmap on screen when their scroll position changes (a ghost image). collapsable={false}
      // keeps a real native view so it always repaints correctly.
      collapsable={false}
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, style]}>
      {children}
    </AnimatedPressable>
  );
}
