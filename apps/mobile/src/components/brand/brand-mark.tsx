import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { brand } from '@/theme/tokens';
import { GRADIENT_AXIS, GRADIENT_OFFSETS, MARK_SHAPES, type MarkWeight, VIEWBOX } from './brand-geometry';

/** The violet -> magenta -> orange brand gradient, in viewBox units. Place inside <Defs>. */
export function BrandGradient({ id }: { id: string }) {
  return (
    <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={GRADIENT_AXIS.x1} y1={GRADIENT_AXIS.y1} x2={GRADIENT_AXIS.x2} y2={GRADIENT_AXIS.y2}>
      <Stop offset={GRADIENT_OFFSETS[0]} stopColor={brand.gradient[0]} />
      <Stop offset={GRADIENT_OFFSETS[1]} stopColor={brand.gradient[1]} />
      <Stop offset={GRADIENT_OFFSETS[2]} stopColor={brand.gradient[2]} />
    </LinearGradient>
  );
}

type BrandMarkProps = {
  size: number;
  /** Single-colour mark (e.g. on a photo or a coloured surface). */
  monochrome?: boolean;
  /** Colour used when `monochrome` is set. */
  color?: string;
  /**
   * `regular` (default): three arcs and the orbit dot, matching the animated mark.
   * `bold`: the launcher-icon cut (two heavy arcs, bigger core, no dot) for small sizes or badges.
   */
  weight?: MarkWeight;
};

/**
 * Static Broadcast mark: a rounded play core and arcs fanning out to the right. In the regular
 * weight the orange dot rides the outer arc, knocked out of it with a real transparent gap.
 */
export function BrandMark({ size, monochrome = false, color = '#FFFFFF', weight = 'regular' }: BrandMarkProps) {
  const shapes = MARK_SHAPES[weight];
  const id = `bm-${weight}`;
  const paint = monochrome ? color : `url(#${id}-grad)`;
  const dot = shapes.dot;
  const knock = dot != null && !dot.detached;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} accessible={false}>
      <Defs>
        <BrandGradient id={`${id}-grad`} />
        {knock ? (
          <Mask id={`${id}-knock`} maskUnits="userSpaceOnUse" x={0} y={0} width={VIEWBOX} height={VIEWBOX}>
            <Rect width={VIEWBOX} height={VIEWBOX} fill="#FFFFFF" />
            <Circle cx={dot.x} cy={dot.y} r={dot.r + dot.gap} fill="#000000" />
          </Mask>
        ) : null}
      </Defs>
      <Path d={shapes.core} fill={paint} />
      <G mask={knock ? `url(#${id}-knock)` : undefined}>
        {shapes.arcs.map((d) => (
          <Path key={d} d={d} fill="none" stroke={paint} strokeWidth={shapes.stroke} strokeLinecap="round" />
        ))}
      </G>
      {dot ? <Circle cx={dot.x} cy={dot.y} r={dot.r} fill={monochrome ? color : brand.warm} /> : null}
    </Svg>
  );
}
