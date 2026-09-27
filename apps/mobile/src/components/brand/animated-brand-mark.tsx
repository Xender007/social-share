import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { brand } from '@/theme/tokens';
import {
  ARC_PATHS,
  ARC_RADII,
  ARC_STROKE,
  arcHalfLength,
  CORE_CENTER,
  CORE_CENTROID,
  CORE_PATH,
  DOT,
  GLOW_CENTER,
  GLOW_RADIUS,
  VIEWBOX,
} from './brand-geometry';
import { BrandGradient } from './brand-mark';

const AnimatedPath = Animated.createAnimatedComponent(Path);const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Choreography (ms from mount). Intro, then it hands over to the loop without a seam:
 *   0     core fades in (260) and springs 0.4 -> 1 about its centroid (slight overshoot, settles ~550)
 *   240   arcs draw from their middle outwards, inner -> outer, 120 stagger, 560 each (done 1040)
 *   300   glow ring pulses out once (1100); ambient glow warms up from 200 (900)
 *   880   dot pops onto the outer arc (spring) as it finishes drawing under it
 *   1040  intro done -> onIntroDone; the dot starts its orbit, the broadcast wave blends in over 600
 *         (starting on the outer arc's peak, so the draw-in flows straight into the pulse) and the
 *         glow starts breathing
 * Loop: arcs pulse inner -> outer (1200 period), dot swings along the outer arc (6400 period),
 * glow breathes (3200 period).
 *
 * Performance: each part is its own static <Svg> layer, animated with view opacity/transforms on the
 * UI thread, so the loop never re-rasterises SVG (react-native-svg redraws the whole <Svg> on the CPU
 * for any animated prop change). Only the intro's arc draw-in and ring pulse animate SVG props, each in
 * its own small layer. (Previously the core's scale was baked into a path string rebuilt every frame.)
 */
export const BRAND_TIMING = {
  coreFade: 260,
  arcStart: 240,
  arcStagger: 120,
  arcDraw: 560,
  ringStart: 300,
  ringDuration: 1100,
  glowStart: 200,
  glowDuration: 900,
  dotAt: 880,
  introDone: 240 + 2 * 120 + 560, // outer arc finished drawing
  wavePeriod: 1200,
  waveBlend: 600,
  orbitPeriod: 6400,
  breathHalf: 1600,
} as const;

/** Emphasised deceleration (M3) for the line draw: quick start, long silky settle. */
const DRAW_EASE = Easing.bezier(0.2, 0, 0, 1);
const CORE_SPRING = { damping: 12, stiffness: 170, mass: 0.9 };
const DOT_SPRING = { damping: 10, stiffness: 240, mass: 0.7 };
/** Arc-to-arc offset of the broadcast wave, as a fraction of its period (leaves a beat of rest). */
const WAVE_LAG = 0.2;
/**
 * Wave phase at which the outer arc peaks: the draw-in ends on the outer arc, so the pulse picks up
 * right where it left off, rests, then sweeps inner -> outer again.
 */
const WAVE_START = 0.5 + 2 * WAVE_LAG;
/** Orbit phase whose sine lands the dot on its rest angle, so the static and moving marks agree. */
const ORBIT_PHASE_0 = Math.asin(DOT.restAngleDeg / DOT.orbitAmplitudeDeg);
const TAU = Math.PI * 2;

type Mode = 'intro' | 'loop';

type AnimatedBrandMarkProps = {
  size: number;
  /** `intro` plays the build-up then continues into the loop; `loop` starts complete. Read on mount. */
  mode?: Mode;
  onIntroDone?: () => void;
  /** Background colour behind the mark; draws a ring around the dot so it reads as cut out of the arc. */
  haloColor?: string;
  /** Soft radial glow behind the mark (on by default). */
  glow?: boolean;
};

/** Draw-in only (SVG prop): changes during the 560 ms draw, then never again. */
function useArcDraw(index: number, draw: SharedValue<number>) {
  const dash = arcHalfLength(ARC_RADII[index]) + 1;
  return useAnimatedProps(() => ({
    // Dash pattern restarts per subpath, and each arc is two subpaths from its middle, so this
    // draws the arc outwards in both directions. Offset dash + 0.5 hides it without a stray cap dot.
    strokeDashoffset: (1 - draw.get()) * (dash + 0.5),
  }));
}

/** Visibility + broadcast wave as the arc layer's view opacity (no SVG re-raster in the loop). */
function useArcStyle(index: number, draw: SharedValue<number>, wave: SharedValue<number>, waveMix: SharedValue<number>) {
  return useAnimatedStyle(() => {
    let x = wave.get() - index * WAVE_LAG;
    x -= Math.floor(x);
    const bump = Math.pow(0.5 - 0.5 * Math.cos(TAU * x), 1.6);
    const level = 0.28 + 0.72 * bump;
    const mix = waveMix.get();
    return { opacity: (draw.get() > 0.001 ? 1 : 0) * (1 - mix + mix * level) };
  });
}

export function AnimatedBrandMark({ size, mode = 'loop', onIntroDone, haloColor, glow = true }: AnimatedBrandMarkProps) {
  const reduced = useReducedMotion();
  const startsComplete = reduced || mode === 'loop';
  const from = startsComplete ? 1 : 0;

  const core = useSharedValue(from);
  const coreScale = useSharedValue(startsComplete ? 1 : 0.4);
  const draw0 = useSharedValue(from);
  const draw1 = useSharedValue(from);
  const draw2 = useSharedValue(from);
  const ring = useSharedValue(0);
  const glowIn = useSharedValue(from);
  const breath = useSharedValue(0.5);
  const dotIn = useSharedValue(from);
  const orbit = useSharedValue(ORBIT_PHASE_0);
  const wave = useSharedValue(WAVE_START);
  const waveMix = useSharedValue(0);

  const onIntroDoneRef = useRef(onIntroDone);
  useEffect(() => {
    onIntroDoneRef.current = onIntroDone;
  });

  useEffect(() => {
    const values = [core, coreScale, draw0, draw1, draw2, ring, glowIn, breath, dotIn, orbit, wave, waveMix];
    const fireIntroDone = () => onIntroDoneRef.current?.();

    if (reduced) {
      if (mode === 'intro') fireIntroDone();
      return undefined;
    }

    const startLoops = (delay: number) => {
      wave.set(
        withDelay(delay, withRepeat(withTiming(WAVE_START + 1, { duration: BRAND_TIMING.wavePeriod, easing: Easing.linear }), -1, false)),
      );
      waveMix.set(withDelay(delay, withTiming(1, { duration: BRAND_TIMING.waveBlend, easing: Easing.inOut(Easing.quad) })));
      orbit.set(
        withDelay(delay, withRepeat(withTiming(ORBIT_PHASE_0 + TAU, { duration: BRAND_TIMING.orbitPeriod, easing: Easing.linear }), -1, false)),
      );
      breath.set(withDelay(delay, withRepeat(withTiming(1, { duration: BRAND_TIMING.breathHalf, easing: Easing.inOut(Easing.sin) }), -1, true)));
    };

    if (mode === 'loop') {
      startLoops(0);
    } else {
      const t = BRAND_TIMING;
      core.set(withTiming(1, { duration: t.coreFade, easing: Easing.out(Easing.quad) }));
      coreScale.set(withSpring(1, CORE_SPRING));
      draw0.set(withDelay(t.arcStart, withTiming(1, { duration: t.arcDraw, easing: DRAW_EASE })));
      draw1.set(withDelay(t.arcStart + t.arcStagger, withTiming(1, { duration: t.arcDraw, easing: DRAW_EASE })));
      draw2.set(
        withDelay(
          t.arcStart + 2 * t.arcStagger,
          withTiming(1, { duration: t.arcDraw, easing: DRAW_EASE }, (finished) => {
            if (finished) scheduleOnRN(fireIntroDone);
          }),
        ),
      );
      ring.set(withDelay(t.ringStart, withTiming(1, { duration: t.ringDuration, easing: Easing.out(Easing.cubic) })));
      glowIn.set(withDelay(t.glowStart, withTiming(1, { duration: t.glowDuration, easing: Easing.out(Easing.quad) })));
      dotIn.set(withDelay(t.dotAt, withSpring(1, DOT_SPRING)));
      startLoops(t.introDone);
    }

    return () => values.forEach((v) => cancelAnimation(v));
    // Shared values are stable; the animation plan is chosen once per mode / motion preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduced]);

  // Core: fade + spring scale about the triangle's centroid, as a view transform (no SVG re-raster).
  // Pivot offsets (px from the view centre); explicit translate-scale-translate instead of transformOrigin.
  const half = size / 2;
  const u = size / VIEWBOX;
  const coreDx = CORE_CENTROID.x * u - half;
  const orbitDx = CORE_CENTER.x * u - half;
  const dotX = CORE_CENTER.x + DOT.orbitRadius;
  const dotDx = dotX * u - half;
  const coreStyle = useAnimatedStyle(() => ({
    opacity: core.get(),
    transform: [{ translateX: coreDx }, { scale: coreScale.get() }, { translateX: -coreDx }],
  }));

  const arc0 = useArcDraw(0, draw0);
  const arc1 = useArcDraw(1, draw1);
  const arc2 = useArcDraw(2, draw2);
  const arcStyle0 = useArcStyle(0, draw0, wave, waveMix);
  const arcStyle1 = useArcStyle(1, draw1, wave, waveMix);
  const arcStyle2 = useArcStyle(2, draw2, wave, waveMix);

  // Glow breathes by scaling its (static) layer about the glow centre, which is the view centre.
  const glowStyle = useAnimatedStyle(() => {
    const b = breath.get();
    return { opacity: glowIn.get() * (0.55 + 0.45 * b), transform: [{ scale: 0.9 + 0.1 * b }] };
  });

  // The ring's stroke thins as it grows, which a transform can't express; it only animates for the
  // 1.1 s intro pulse and lives in its own small layer, so only that layer re-rasters.
  const ringProps = useAnimatedProps(() => {
    const p = ring.get();
    return {
      r: 26 + (GLOW_RADIUS - 26) * p,
      strokeWidth: 3 * (1 - p) + 0.5,
      opacity: p > 0 && p < 1 ? 0.65 * Math.pow(1 - p, 1.4) : 0,
    };
  });

  // Dot + halo: drawn once at angle 0 on the outer arc; the orbit is a rotation about CORE_CENTER and
  // the pop-in a scale about the dot, both native view transforms.
  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: orbitDx }, { rotate: `${DOT.orbitAmplitudeDeg * Math.sin(orbit.get())}deg` }, { translateX: -orbitDx }],
  }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dotDx }, { scale: Math.max(dotIn.get(), 0.001) }, { translateX: -dotDx }] }));

  const arcDraws = [arc0, arc1, arc2];
  const arcStyles = [arcStyle0, arcStyle1, arcStyle2];
  const box = `0 0 ${VIEWBOX} ${VIEWBOX}`;

  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      {glow ? (
        <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, glowStyle]}>
          <Svg width={size} height={size} viewBox={box}>
            <Defs>
              <RadialGradient id="abm-glow" gradientUnits="userSpaceOnUse" cx={GLOW_CENTER.x} cy={GLOW_CENTER.y} r={GLOW_RADIUS}>
                <Stop offset={0} stopColor={brand.start} stopOpacity={0.38} />
                <Stop offset={0.45} stopColor={brand.start} stopOpacity={0.16} />
                <Stop offset={0.75} stopColor={brand.mid} stopOpacity={0.06} />
                <Stop offset={1} stopColor={brand.mid} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={GLOW_CENTER.x} cy={GLOW_CENTER.y} r={GLOW_RADIUS} fill="url(#abm-glow)" />
          </Svg>
        </Animated.View>
      ) : null}
      {startsComplete ? null : (
        <Svg width={size} height={size} viewBox={box} style={StyleSheet.absoluteFill}>
          <Defs>
            <BrandGradient id="abm-ring-grad" />
          </Defs>
          <AnimatedCircle cx={GLOW_CENTER.x} cy={GLOW_CENTER.y} fill="none" stroke="url(#abm-ring-grad)" animatedProps={ringProps} />
        </Svg>
      )}
      <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, coreStyle]}>
        <Svg width={size} height={size} viewBox={box}>
          <Defs>
            <BrandGradient id="abm-core-grad" />
          </Defs>
          <Path d={CORE_PATH} fill="url(#abm-core-grad)" />
        </Svg>
      </Animated.View>
      {ARC_PATHS.map((d, i) => {
        const dash = arcHalfLength(ARC_RADII[i]) + 1;
        return (
          <Animated.View key={d} collapsable={false} style={[StyleSheet.absoluteFill, arcStyles[i]]}>
            <Svg width={size} height={size} viewBox={box}>
              <Defs>
                <BrandGradient id={`abm-arc${i}-grad`} />
              </Defs>
              {startsComplete ? (
                <Path d={d} fill="none" stroke={`url(#abm-arc${i}-grad)`} strokeWidth={ARC_STROKE} strokeLinecap="round" />
              ) : (
                <AnimatedPath
                  d={d}
                  fill="none"
                  stroke={`url(#abm-arc${i}-grad)`}
                  strokeWidth={ARC_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={[dash, dash * 2]}
                  animatedProps={arcDraws[i]}
                />
              )}
            </Svg>
          </Animated.View>
        );
      })}
      <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, orbitStyle]}>
        <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, dotStyle]}>
          <Svg width={size} height={size} viewBox={box}>
            {haloColor ? <Circle cx={dotX} cy={CORE_CENTER.y} r={DOT.radius + DOT.halo} fill={haloColor} /> : null}
            <Circle cx={dotX} cy={CORE_CENTER.y} r={DOT.radius} fill={brand.warm} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
