import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Circle, RadialGradient, Stop } from 'react-native-svg';
import { brand } from '@/theme/tokens';

export interface GlowBackgroundProps {
  /** Dark mode: 10-18% opacity blobs. Light mode: 8-12%. Defaults to the current best-practice mid-point. */
  dark?: boolean;
}

/**
 * Decorative ambient radial glows (violet + magenta) behind screen content. Purely visual —
 * hidden from accessibility and never intercepts touches.
 */
export function GlowBackground({ dark }: GlowBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const violetOpacity = dark ? 0.16 : 0.1;
  const magentaOpacity = dark ? 0.12 : 0.08;

  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="glow-violet" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={brand.violet} stopOpacity={violetOpacity} />
            <Stop offset="100%" stopColor={brand.violet} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="glow-magenta" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={brand.magenta} stopOpacity={magentaOpacity} />
            <Stop offset="100%" stopColor={brand.magenta} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={width * 0.15} cy={height * 0.05} r={width * 0.55} fill="url(#glow-violet)" />
        <Circle cx={width * 0.95} cy={height * 0.3} r={width * 0.5} fill="url(#glow-magenta)" />
      </Svg>
    </View>
  );
}
