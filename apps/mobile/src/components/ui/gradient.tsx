import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { brand } from '@/theme/tokens';

export interface GradientFillProps {
  /** Stop colours, in order. Defaults to the brand gradient (violet -> magenta -> orange). */
  colors?: readonly string[];
  /**
   * Gradient angle in degrees, CSS `linear-gradient` convention: 0 = bottom-to-top, 90 = left-to-right,
   * 180 = top-to-bottom. Defaults to 135 (top-left violet -> bottom-right orange, per BROADCAST.md).
   */
  angle?: number;
  /** Optional per-stop opacity (0..1), same length as `colors`. Defaults to fully opaque. */
  opacities?: readonly number[];
  style?: StyleProp<ViewStyle>;
  /**
   * Corner radius. Applied to the wrapping View (with overflow hidden), NOT to the SVG rect: SVG clamps
   * rx/ry independently (rx <= w/2, ry <= h/2), which turned large radii into an ellipse. RN's View
   * clamps borderRadius to a proper stadium. Parents that already clip (borderRadius + overflow hidden)
   * don't need to pass this.
   */
  borderRadius?: number;
}

/**
 * Converts a CSS-style angle to SVG objectBoundingBox x1/y1/x2/y2 so the 0% and 100% stops land exactly
 * on the box corners the gradient line points away from / towards (135 => (0,0) -> (1,1)).
 */
export function angleToVector(angle: number) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // Half-length of the gradient line: projection of the box's half-diagonal onto the direction.
  const half = 0.5 * (Math.abs(dx) + Math.abs(dy));
  return {
    x1: (0.5 - dx * half).toFixed(4),
    y1: (0.5 - dy * half).toFixed(4),
    x2: (0.5 + dx * half).toFixed(4),
    y2: (0.5 + dy * half).toFixed(4),
  };
}

/** Absolute-fill SVG linear gradient. Use as a background layer behind content (e.g. inside a Card or Button). */
export function GradientFill({ colors = brand.gradient, angle = 135, opacities, style, borderRadius }: GradientFillProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `gradient-fill-${id}`;
  const vector = angleToVector(angle);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, borderRadius != null ? { borderRadius, overflow: 'hidden' } : null, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1={vector.x1} y1={vector.y1} x2={vector.x2} y2={vector.y2}>
            {colors.map((c, i) => (
              <Stop
                key={c + i}
                offset={`${(i / Math.max(colors.length - 1, 1)) * 100}%`}
                stopColor={c}
                stopOpacity={opacities?.[i] ?? 1}
              />
            ))}
          </LinearGradient>
        </Defs>
        {/* Plain rectangle: rounding comes from the clipping parent / wrapper, never from SVG rx. */}
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}
