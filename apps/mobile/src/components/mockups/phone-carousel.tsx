import * as Haptics from 'expo-haptics';
import { memo, useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop, Ellipse } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { brand, fonts, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { PhoneFrame, phoneMetrics } from './phone-frame';

export interface PhoneSlideContext {
  /** True only for the centred slide (use it to play video only there). */
  active: boolean;
  /** Width of the phone's screen area, in dp. */
  width: number;
}

export interface PhoneSlide {
  key: string;
  render: (ctx: PhoneSlideContext) => ReactNode;
  /** Shown under the active phone (crossfades) and read by screen readers. */
  label?: string;
}

export interface PhoneCarouselProps {
  slides: PhoneSlide[];
  /** Outer width of the centre phone. Defaults to ~56% of the container, capped at 250. */
  phoneWidth?: number;
  /** Autoplay interval in ms. Off by default; pauses while touching and with reduced motion. */
  autoPlay?: number;
  onIndexChange?: (index: number) => void;
  initialIndex?: number;
  accessibilityLabel?: string;
  tone?: 'dark' | 'light';
  style?: StyleProp<ViewStyle>;
}

const SPRING = { damping: 20, stiffness: 170, mass: 1 } as const;
const SIDE_SCALE = 0.74;
const SIDE_ROTATE = 18;
const CLAMP = Extrapolation.CLAMP;

/** Resistance past the first/last slide, in index units (asymptotes at 0.3). */
function rubber(overshoot: number) {
  'worklet';
  return (0.3 * overshoot) / (overshoot + 0.5);
}

/**
 * Cover-flow style carousel of phone mockups. The centre phone is full size; neighbours are scaled,
 * turned in 3D toward the centre, tucked inward and dimmed. Everything is driven on the UI thread
 * from one shared `progress` value (fractional slide index).
 */
export function PhoneCarousel({
  slides,
  phoneWidth: phoneWidthProp,
  autoPlay,
  onIndexChange,
  initialIndex = 0,
  accessibilityLabel = 'Post previews',
  tone = 'dark',
  style,
}: PhoneCarouselProps) {
  const { colors, dark } = useTheme();
  const reduced = useReducedMotion();
  const window = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(window.width);
  const n = slides.length;
  const last = Math.max(n - 1, 0);
  const startIndex = Math.min(Math.max(Math.round(initialIndex), 0), last);

  const phoneWidth = phoneWidthProp ?? Math.round(Math.min(containerWidth * 0.56, 250));
  const m = phoneMetrics(phoneWidth);
  // Distance between phone centres. Less than the side phone's width, so neighbours tuck behind.
  const step = phoneWidth * 0.74;
  const padTop = spacing.md;
  const padBottom = Math.round(phoneWidth * 0.12);
  const stageHeight = m.height + padTop + padBottom;

  const progress = useSharedValue(startIndex);
  const panStart = useSharedValue(startIndex);
  const [index, setIndex] = useState(startIndex);
  const indexRef = useRef(startIndex);
  const [touching, setTouching] = useState(false);

  const select = (i: number, haptic: boolean) => {
    if (i === indexRef.current) return;
    indexRef.current = i;
    onIndexChange?.(i);
    if (haptic) void Haptics.selectionAsync();
  };

  // The active slide (which owns the live video player) only changes once the move has settled:
  // creating/tearing down players mid-spring caused the worst frame spikes while swiping.
  const activate = (i: number) => {
    if (i === indexRef.current) setIndex(i);
  };
  const settle = (target: number, velocity = 0) => {
    'worklet';
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(activate, target);
    };
    progress.value = reduced ? withTiming(target, { duration: 250 }, done) : withSpring(target, { ...SPRING, velocity }, done);
  };

  const goTo = (i: number, haptic: boolean) => {
    const target = Math.min(Math.max(i, 0), last);
    settle(target);
    select(target, haptic);
  };

  const advance = useEffectEvent(() => goTo((indexRef.current + 1) % Math.max(n, 1), false));
  useEffect(() => {
    if (!autoPlay || reduced || touching || n < 2) return;
    const id = setInterval(advance, autoPlay);
    return () => clearInterval(id);
  }, [autoPlay, reduced, touching, n]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      // Only autoplay reads 'touching'; don't re-render the carousel on every touch otherwise.
      if (autoPlay) scheduleOnRN(setTouching, true);
    })
    .onStart(() => {
      cancelAnimation(progress);
      panStart.value = progress.value;
    })
    .onUpdate((e) => {
      const raw = panStart.value - e.translationX / step;
      progress.value = raw < 0 ? -rubber(-raw) : raw > last ? last + rubber(raw - last) : raw;
    })
    .onEnd((e) => {
      const velocity = -e.velocityX / step; // slides per second
      const base = Math.round(panStart.value);
      const projected = Math.round(progress.value + velocity * 0.2);
      const target = Math.min(Math.max(Math.min(Math.max(projected, base - 1), base + 1), 0), last);
      settle(target, velocity);
      scheduleOnRN(select, target, true);
    })
    .onFinalize(() => {
      if (autoPlay) scheduleOnRN(setTouching, false);
    });

  // Tapping a side phone brings it to the centre.
  const tap = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e, success) => {
      if (!success) return;
      const dx = e.x - containerWidth / 2;
      if (Math.abs(dx) < phoneWidth / 2) return;
      const current = Math.round(progress.value);
      const target = Math.min(Math.max(current + (dx > 0 ? 1 : -1), 0), last);
      if (target === current) return;
      settle(target);
      scheduleOnRN(select, target, true);
    });

  const gesture = Gesture.Race(pan, tap);

  const slideText = (i: number) => `Slide ${i + 1} of ${n}${slides[i]?.label ? `, ${slides[i].label}` : ''}`;
  const hasLabels = slides.some((s) => s.label);

  if (n === 0) return null;

  // Own root view so the carousel works even where the app root has no GestureHandlerRootView.
  return (
    <GestureHandlerRootView style={style}>
      <View
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: slideText(index) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const next = index + (e.nativeEvent.actionName === 'increment' ? 1 : -1);
          if (next < 0 || next > last) return;
          goTo(next, false);
          AccessibilityInfo.announceForAccessibility(slideText(next));
        }}>
        <GestureDetector gesture={gesture}>
          <View style={{ height: stageHeight, width: '100%' }}>
            <Glow progress={progress} phoneWidth={phoneWidth} phoneHeight={m.height} top={padTop} containerWidth={containerWidth} dark={dark} />
            {slides.map((slide, i) => (
              <SlideView
                key={slide.key}
                i={i}
                progress={progress}
                step={step}
                reduced={reduced}
                left={containerWidth / 2 - phoneWidth / 2}
                top={padTop}
                radius={m.radius}
                dimColor={colors.surface}
                dimMax={dark ? 0.55 : 0.5}>
                <SlideContent slide={slide} active={i === index} phoneWidth={phoneWidth} screenWidth={m.screenWidth} tone={tone} />
              </SlideView>
            ))}
          </View>
        </GestureDetector>

        {hasLabels ? (
          <View style={styles.labelRow} pointerEvents="none">
            {slides.map((slide, i) => (
              <SlideLabel key={slide.key} i={i} progress={progress} color={colors.onSurface}>
                {slide.label ?? ''}
              </SlideLabel>
            ))}
          </View>
        ) : null}

        {n > 1 ? (
          <View style={styles.dots} importantForAccessibility="no-hide-descendants">
            {slides.map((slide, i) => (
              <Pressable key={slide.key} hitSlop={10} onPress={() => goTo(i, true)} accessible={false}>
                <Dot i={i} progress={progress} track={colors.outline} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

/**
 * One phone and its preview. Memoised so an index change / touch only re-renders the slides whose
 * 'active' flag flipped, not all three phones (the previews are heavy: SVG gradients, video).
 */
const SlideContent = memo(function SlideContent({
  slide,
  active,
  phoneWidth,
  screenWidth,
  tone,
}: {
  slide: PhoneSlide;
  active: boolean;
  phoneWidth: number;
  screenWidth: number;
  tone: 'dark' | 'light';
}) {
  return (
    <PhoneFrame width={phoneWidth} tone={tone}>
      {slide.render({ active, width: screenWidth })}
    </PhoneFrame>
  );
});

interface SlideViewProps {
  i: number;
  progress: SharedValue<number>;
  step: number;
  reduced: boolean;
  left: number;
  top: number;
  radius: number;
  dimColor: string;
  dimMax: number;
  children: ReactNode;
}

function SlideView({ i, progress, step, reduced, left, top, radius, dimColor, dimMax, children }: SlideViewProps) {
  const animated = useAnimatedStyle(() => {
    const d = i - progress.value;
    const ad = Math.abs(d);
    const scale = interpolate(ad, [0, 1, 2], [1, SIDE_SCALE, 0.68], CLAMP);
    const rotate = reduced ? 0 : interpolate(d, [-1, 0, 1], [SIDE_ROTATE, 0, -SIDE_ROTATE], CLAMP);
    // Nudge further neighbours inward so they stack behind the first neighbour instead of fanning out.
    const tuck = interpolate(ad, [1, 2], [0, step * 0.35], CLAMP) * Math.sign(d);
    return {
      opacity: interpolate(ad, [0, 1, 1.7], [1, 0.95, 0], CLAMP),
      zIndex: Math.round(100 - ad * 10),
      transform: [{ perspective: 900 }, { translateX: d * step - tuck }, { rotateY: `${rotate}deg` }, { scale }],
    };
  });
  const dim = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(i - progress.value), [0, 1], [0, dimMax], CLAMP),
  }));

  return (
    <Animated.View style={[{ position: 'absolute', left, top }, animated]}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: dimColor }, dim]} />
    </Animated.View>
  );
}

function Glow({
  progress,
  phoneWidth,
  phoneHeight,
  top,
  containerWidth,
  dark,
}: {
  progress: SharedValue<number>;
  phoneWidth: number;
  phoneHeight: number;
  top: number;
  containerWidth: number;
  dark: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  // Dims while between slides, full when a phone is settled in the centre.
  const animated = useAnimatedStyle(() => {
    const frac = Math.abs(progress.value - Math.round(progress.value));
    return { opacity: 1 - frac * 1.2 };
  });
  const w = Math.min(containerWidth, phoneWidth * 1.9);
  const h = phoneHeight + phoneWidth * 0.3;
  const halo = dark ? 0.26 : 0.16;
  const floor = dark ? 0.55 : 0.35;

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: top - phoneWidth * 0.1, left: containerWidth / 2 - w / 2, width: w, height: h }, animated]}>
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient id={`halo${uid}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={brand.violet} stopOpacity={halo} />
            <Stop offset="0.55" stopColor={brand.magenta} stopOpacity={halo * 0.45} />
            <Stop offset="1" stopColor={brand.magenta} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`floor${uid}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={brand.magenta} stopOpacity={floor} />
            <Stop offset="0.5" stopColor={brand.violet} stopOpacity={floor * 0.4} />
            <Stop offset="1" stopColor={brand.violet} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={w / 2} cy={h * 0.48} rx={w / 2} ry={h * 0.48} fill={`url(#halo${uid})`} />
        <Ellipse cx={w / 2} cy={phoneWidth * 0.1 + phoneHeight + phoneWidth * 0.03} rx={phoneWidth * 0.66} ry={phoneWidth * 0.11} fill={`url(#floor${uid})`} />
      </Svg>
    </Animated.View>
  );
}

function SlideLabel({ i, progress, color, children }: { i: number; progress: SharedValue<number>; color: string; children: string }) {
  const animated = useAnimatedStyle(() => {
    const ad = Math.abs(i - progress.value);
    return {
      opacity: interpolate(ad, [0, 0.5], [1, 0], CLAMP),
      transform: [{ translateY: interpolate(i - progress.value, [-0.5, 0, 0.5], [-6, 0, 6], CLAMP) }],
    };
  });
  return <Animated.Text style={[styles.label, { color }, animated]}>{children}</Animated.Text>;
}

function Dot({ i, progress, track }: { i: number; progress: SharedValue<number>; track: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const size = useAnimatedStyle(() => ({ width: interpolate(Math.abs(i - progress.value), [0, 1], [24, 7], CLAMP) }));
  const fill = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(i - progress.value), [0, 0.8], [1, 0], CLAMP) }));
  return (
    <Animated.View style={[styles.dot, size]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: track, opacity: 0.35 }]} />
      <Animated.View style={[StyleSheet.absoluteFill, fill]}>
        <Svg width={24} height={7}>
          <Defs>
            <LinearGradient id={`dot${uid}`} x1="0" y1="0" x2="1" y2="0">
              {brand.gradient.map((c, k) => (
                <Stop key={c} offset={k / (brand.gradient.length - 1)} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={24} height={7} fill={`url(#dot${uid})`} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  labelRow: { height: 24, marginTop: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  label: { position: 'absolute', fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20, letterSpacing: 0.1 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: spacing.sm, height: 12 },
  dot: { height: 7, borderRadius: 4, overflow: 'hidden' },
});
