import * as Font from 'expo-font';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { brand, fonts } from '@/theme/tokens';
import { AnimatedBrandMark } from './animated-brand-mark';

const MARK_SIZE = 132;

/**
 * Splash choreography (ms from mount; the mark's own intro is documented in animated-brand-mark.tsx):
 *   0     ambient glow blooms in (900), mark intro starts
 *   700   wordmark fades up 8 px (520, emphasised decelerate); tagline follows at 820
 *   ...   mark loops while waiting for `ready`, never exiting before MIN_VISIBLE
 *   exit  light haptic; mark scales to 1.15 while the overlay fades out (350, emphasised accelerate),
 *         then onFinish on the JS thread
 * Reduced motion: everything is shown at rest and the exit is a short crossfade.
 */
const TIMING = {
  ambient: 900,
  wordmarkAt: 700,
  taglineAt: 820,
  textIn: 520,
  minVisible: 1600,
  minVisibleReduced: 400,
  exit: 350,
  exitReduced: 200,
} as const;

const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);
const ACCELERATE = Easing.bezier(0.3, 0, 0.8, 0.15);

type AnimatedSplashProps = {
  /** The app underneath is ready to be revealed. */
  ready: boolean;
  onFinish: () => void;
  /** Whether the brand fonts are available; falls back to the system font until they are. */
  fontsLoaded?: boolean;
  /**
   * The mark's intro has finished (immediately under reduced motion). Mount heavy trees after this:
   * SVG prop animations go through Fabric commits, so a big React mount mid-intro freezes it.
   */
  onIntroDone?: () => void;
};

export function AnimatedSplash({ ready, onFinish, fontsLoaded, onIntroDone }: AnimatedSplashProps) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const brandFonts = fontsLoaded ?? (Font.isLoaded(fonts.display) && Font.isLoaded(fonts.body));

  const [minElapsed, setMinElapsed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  const ambient = useSharedValue(reduced ? 1 : 0);
  const wordmark = useSharedValue(reduced ? 1 : 0);
  const tagline = useSharedValue(reduced ? 1 : 0);
  const overlay = useSharedValue(1);
  const markScale = useSharedValue(1);

  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), reduced ? TIMING.minVisibleReduced : TIMING.minVisible);
    if (!reduced) {
      ambient.set(withTiming(1, { duration: TIMING.ambient, easing: Easing.out(Easing.quad) }));
      wordmark.set(withDelay(TIMING.wordmarkAt, withTiming(1, { duration: TIMING.textIn, easing: DECELERATE })));
      tagline.set(withDelay(TIMING.taglineAt, withTiming(1, { duration: TIMING.textIn, easing: DECELERATE })));
    }
    return () => clearTimeout(timer);
    // Runs once on mount; shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !minElapsed || exiting) return;
    setExiting(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const finish = () => onFinishRef.current();
    if (reduced) {
      overlay.set(
        withTiming(0, { duration: TIMING.exitReduced, easing: Easing.linear }, (done) => {
          if (done) scheduleOnRN(finish);
        }),
      );
      return;
    }
    markScale.set(withTiming(1.15, { duration: TIMING.exit, easing: ACCELERATE }));
    overlay.set(
      withTiming(0, { duration: TIMING.exit, easing: ACCELERATE }, (done) => {
        if (done) scheduleOnRN(finish);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, minElapsed, exiting, reduced]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.get() }));
  const ambientStyle = useAnimatedStyle(() => ({ opacity: ambient.get() }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: markScale.get() }] }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmark.get(),
    transform: [{ translateY: 8 * (1 - wordmark.get()) }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.get(),
    transform: [{ translateY: 8 * (1 - tagline.get()) }],
  }));

  const glowRadius = Math.max(width, height) * 0.62;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, overlayStyle]}
      pointerEvents={exiting ? 'none' : 'auto'}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Social Publisher is starting">
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, ambientStyle]} pointerEvents="none">
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id="splash-ambient" gradientUnits="userSpaceOnUse" cx={width / 2} cy={height / 2} r={glowRadius}>
              <Stop offset={0} stopColor={brand.start} stopOpacity={0.34} />
              <Stop offset={0.35} stopColor={brand.start} stopOpacity={0.15} />
              <Stop offset={0.65} stopColor={brand.mid} stopOpacity={0.06} />
              <Stop offset={1} stopColor={brand.mid} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#splash-ambient)" />
        </Svg>
      </Animated.View>

      {/* The mark sits dead centre, where the native splash icon was, so the handoff doesn't jump. */}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Animated.View style={markStyle}>
          <AnimatedBrandMark size={MARK_SIZE} mode="intro" haloColor={brand.ink} onIntroDone={onIntroDone} />
        </Animated.View>
      </View>

      <View style={[styles.text, { top: height / 2 + MARK_SIZE / 2 + 20 }]} pointerEvents="none">
        <Animated.Text
          style={[styles.wordmark, brandFonts ? { fontFamily: fonts.display } : { fontWeight: '700' }, wordmarkStyle]}
          allowFontScaling={false}>
          Social Publisher
        </Animated.Text>
        <Animated.Text
          style={[styles.tagline, brandFonts ? { fontFamily: fonts.body } : { fontWeight: '400' }, taglineStyle]}
          allowFontScaling={false}>
          Post once. Everywhere.
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: brand.ink, zIndex: 1000, elevation: 1000 },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 6 },
  wordmark: { color: '#FFFFFF', fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  tagline: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20, letterSpacing: 0.2 },
});
