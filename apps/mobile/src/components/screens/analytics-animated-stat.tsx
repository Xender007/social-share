import { useEffect, useState } from 'react';
import { Easing, runOnJS, useAnimatedReaction, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { ColorScheme, TypeRole } from '@/theme/tokens';
import { Text, type AppTextProps } from '@/components/ui/text';

export interface AnimatedStatProps {
  value: number;
  format: (n: number) => string;
  role?: TypeRole;
  color?: keyof ColorScheme;
  accessibilityLabel?: string;
  style?: AppTextProps['style'];
}

/**
 * Big stat number that counts up from 0 on mount/change (600ms ease-out, per Broadcast spec).
 * Honours reduced motion by jumping straight to the final value.
 */
export function AnimatedStat({ value, format, role = 'stat', color = 'onSurface', accessibilityLabel, style }: AnimatedStatProps) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(reducedMotion ? value : 0);
  const [display, setDisplay] = useState(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) {
      progress.value = value;
      setDisplay(value);
      return;
    }
    progress.value = 0;
    progress.value = withTiming(value, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [value, reducedMotion, progress]);

  useAnimatedReaction(
    () => progress.value,
    (v) => runOnJS(setDisplay)(v),
    [],
  );

  return (
    <Text role={role} color={color} style={style} accessibilityLabel={accessibilityLabel ?? format(value)}>
      {format(display)}
    </Text>
  );
}
