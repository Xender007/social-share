/**
 * Floating bottom drawer ("sheet"). Native recreation of the Base UI Drawer reference:
 * the bottom variant floats 16 dp from the edges (max width 420, radius lg, elevated surface),
 * the fullscreen variant is inset 12 dp and fades + scales in.
 *
 * Renders in a transparent RN <Modal> so it sits above the native tabs. Motion runs on the UI
 * thread (Reanimated 4); dragging uses Gesture Handler on the handle/header and on the body when
 * its ScrollView is at the top.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  use,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  Text as RNText,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  scrollTo,
  useAnimatedKeyboard,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { fonts, radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export type SheetSide = 'bottom' | 'fullscreen';

/** Settle spring after a drag. */
const SETTLE_SPRING = { damping: 22, stiffness: 240, mass: 0.9 } as const;
/** Enter spring: critically damped, ~500 ms (the cubic-bezier(0.23,1,0.32,1) feel). */
const ENTER_SPRING = { duration: 500, dampingRatio: 1 } as const;
const EXIT_MS = 250;
const FADE_MS = 300;
const EXIT_EASING = Easing.bezier(0.4, 0, 1, 1);
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 900;
const BOTTOM_GUTTER = 16;
const FULLSCREEN_GUTTER = 12;
const MAX_WIDTH = 420;
const MAX_HEIGHT_FRACTION = 0.72;

/** Gesture modes. */
const UNDECIDED = 0;
const DRAG_SHEET = 1;
const DRAG_SCROLL = 2;

function rubberBand(distance: number, dimension: number) {
  'worklet';
  const c = 0.55;
  return (distance * dimension * c) / (dimension + c * distance);
}

function hapticLight() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

type NativeGesture = ReturnType<typeof Gesture.Native>;

interface SheetContextValue {
  close: () => void;
  side: SheetSide;
  /** Panel has a fixed height (snap points or fullscreen), so the body fills it. */
  fillsHeight: boolean;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  scrollGesture: NativeGesture;
  scrollY: SharedValue<number>;
  headerBottom: SharedValue<number>;
  titleRef: RefObject<RNText | null>;
}

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheet(component: string) {
  const ctx = use(SheetContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Sheet>.`);
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Sheet (root)
// ---------------------------------------------------------------------------------------------

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: SheetSide;
  /** Fractions of screen height, e.g. [0.45, 0.9]. The sheet opens at the first one. Bottom side only. */
  snapPoints?: number[];
  /** Backdrop tap, Android back and drag-down close the sheet. Default true. */
  dismissible?: boolean;
  children: ReactNode;
}

export function Sheet({ open, onOpenChange, side = 'bottom', snapPoints, dismissible = true, children }: SheetProps) {
  const { dark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const keyboard = useAnimatedKeyboard();

  // Keep the Modal mounted through the exit animation.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const fullscreen = side === 'fullscreen';
  const gutter = fullscreen ? FULLSCREEN_GUTTER : BOTTOM_GUTTER;
  const bottomBase = gutter + insets.bottom;
  const topLimit = insets.top + gutter;
  const available = screenH - topLimit - bottomBase;

  const snaps = !fullscreen && snapPoints && snapPoints.length > 0 ? snapPoints : null;
  const fixedHeight = snaps ? Math.min(Math.max(...snaps) * screenH, available) : undefined;
  // translateY of each resting position, top (most open) first.
  const positions = snaps && fixedHeight ? [...snaps].sort((a, b) => b - a).map((s) => Math.max(0, fixedHeight - s * screenH)) : [0];
  const initialY = snaps && fixedHeight ? Math.max(0, fixedHeight - snaps[0] * screenH) : 0;
  const initialIndex = Math.max(0, positions.indexOf(initialY));
  const maxHeight = Math.min(screenH * MAX_HEIGHT_FRACTION, available);

  const ty = useSharedValue(screenH);
  const fade = useSharedValue(0);
  const height = useSharedValue(0);
  const headerBottom = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const snapIndex = useSharedValue(initialIndex);
  const mode = useSharedValue(UNDECIDED);
  const inHeader = useSharedValue(false);
  const dragOffset = useSharedValue(0);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const titleRef = useRef<RNText | null>(null);
  const panelRef = useRef<View | null>(null);
  const enteredRef = useRef(false);

  const close = () => onOpenChange(false);
  const requestDismiss = () => {
    if (dismissible) onOpenChange(false);
  };

  const moveFocusIn = () => {
    setTimeout(() => {
      const target = titleRef.current ?? panelRef.current;
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
    }, 100);
  };

  // JS-side mirror of the measured height: shared-value writes from JS land on the UI thread
  // asynchronously, so reading `height.value` right after writing it can still return 0.
  const heightRef = useRef(0);

  const animateIn = (h: number) => {
    'worklet';
    snapIndex.value = initialIndex;
    fade.value = withTiming(1, { duration: FADE_MS });
    if (fullscreen || reducedMotion) {
      cancelAnimation(ty);
      ty.value = initialY;
    } else {
      // Start 105 % of the panel below its resting place (plus the floating gap) unless it is
      // already partly visible (re-opened mid-exit), then spring up.
      const hidden = h * 1.05 + bottomBase;
      if (ty.value > hidden) ty.value = hidden;
      ty.value = withSpring(initialY, ENTER_SPRING);
    }
  };

  const startEnter = () => {
    if (!open || enteredRef.current || heightRef.current === 0) return;
    enteredRef.current = true;
    scheduleOnUI(animateIn, heightRef.current);
    moveFocusIn();
  };

  const finishExit = () => {
    setMounted(false);
    heightRef.current = 0;
    ty.value = screenH;
    fade.value = 0;
    height.value = 0;
    scrollY.value = 0;
  };

  useEffect(() => {
    if (open) {
      startEnter();
      return;
    }
    enteredRef.current = false;
    if (!mounted) return;
    const onDone = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(finishExit);
    };
    const h = heightRef.current;
    if (fullscreen || reducedMotion || h === 0) {
      fade.value = withTiming(0, { duration: EXIT_MS }, onDone);
    } else {
      fade.value = withTiming(0, { duration: EXIT_MS });
      ty.value = withTiming(h * 1.05 + bottomBase, { duration: EXIT_MS, easing: EXIT_EASING }, onDone);
    }
    // Only react to open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPanelLayout = (e: LayoutChangeEvent) => {
    heightRef.current = e.nativeEvent.layout.height;
    height.value = e.nativeEvent.layout.height;
    startEnter();
  };

  const top = positions[0];
  const lowest = positions[positions.length - 1];

  const scrollGesture = Gesture.Native();
  const pan = Gesture.Pan()
    .enabled(open)
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .simultaneousWithExternalGesture(scrollGesture)
    .onBegin((e) => {
      inHeader.value = e.y <= headerBottom.value;
      mode.value = UNDECIDED;
    })
    .onUpdate((e) => {
      if (mode.value === UNDECIDED) {
        let next = DRAG_SCROLL;
        if (inHeader.value) next = DRAG_SHEET;
        else if (scrollY.value <= 0.5 && (e.translationY > 0 || ty.value > top + 0.5)) next = DRAG_SHEET;
        mode.value = next;
        if (next === DRAG_SHEET) {
          cancelAnimation(ty);
          dragOffset.value = ty.value - e.translationY;
        }
      }
      if (mode.value !== DRAG_SHEET) return;
      // Body drag: hold the list at the top while the sheet moves.
      if (!inHeader.value && scrollY.value > 0) scrollTo(scrollRef, 0, 0, false);
      let y = dragOffset.value + e.translationY;
      if (y < top) y = top - rubberBand(top - y, height.value);
      else if (!dismissible && y > lowest) y = lowest + rubberBand(y - lowest, height.value);
      ty.value = y;
    })
    .onEnd((e) => {
      if (mode.value !== DRAG_SHEET) return;
      const v = e.velocityY;
      const y = ty.value;
      const visibleAtLowest = Math.max(1, height.value - lowest);
      if (dismissible && (y - lowest > DISMISS_FRACTION * visibleAtLowest || (v > DISMISS_VELOCITY && y >= lowest - 4))) {
        scheduleOnRN(requestDismiss);
        return;
      }
      const projected = y + v * 0.12;
      let idx = 0;
      let best = Number.MAX_VALUE;
      for (let i = 0; i < positions.length; i++) {
        const d = Math.abs(positions[i] - projected);
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      if (idx !== snapIndex.value) {
        snapIndex.value = idx;
        scheduleOnRN(hapticLight);
      }
      ty.value = reducedMotion ? withTiming(positions[idx], { duration: 200 }) : withSpring(positions[idx], { ...SETTLE_SPRING, velocity: v });
    })
    .onFinalize((_e, success) => {
      if (!success && mode.value === DRAG_SHEET) {
        const target = positions[snapIndex.value] ?? 0;
        ty.value = reducedMotion ? withTiming(target, { duration: 200 }) : withSpring(target, SETTLE_SPRING);
      }
      mode.value = UNDECIDED;
    });

  const hiddenY = () => {
    'worklet';
    return fullscreen ? height.value : height.value * 1.05 + bottomBase;
  };

  const backdropStyle = useAnimatedStyle(() => {
    // Backdrop tracks the drag: fully dim at the lowest snap, clear when the panel is hidden.
    const drag = height.value > 0 ? interpolate(ty.value, [lowest, hiddenY()], [1, 0], Extrapolation.CLAMP) : 1;
    return { opacity: fade.value * drag };
  });

  const containerStyle = useAnimatedStyle(() => ({
    bottom: bottomBase + Math.max(0, keyboard.height.value - insets.bottom),
  }));

  const panelStyle = useAnimatedStyle(() => {
    const fades = fullscreen || reducedMotion;
    const scale = fullscreen && !reducedMotion ? interpolate(fade.value, [0, 1], [0.985, 1]) : 1;
    // Fullscreen drag also dims the backdrop via ty; the panel itself only fades on enter/exit.
    return {
      opacity: fades ? fade.value : 1,
      transform: [{ translateY: ty.value }, { scale }],
    };
  });

  const fillsHeight = fullscreen || fixedHeight !== undefined;
  const ctx: SheetContextValue = { close, side, fillsHeight, scrollRef, scrollGesture, scrollY, headerBottom, titleRef };

  const shadow = dark
    ? null
    : { shadowColor: '#2E1065', shadowOpacity: 0.18, shadowRadius: 32, shadowOffset: { width: 0, height: 12 }, elevation: 16 };

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={requestDismiss}
      supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, backdropStyle]}>
          <Pressable
            style={styles.fill}
            onPress={requestDismiss}
            accessible={false}
            importantForAccessibility="no"
          />
        </Animated.View>
        <Animated.View
          pointerEvents="box-none"
          style={[styles.container, { left: gutter, right: gutter, top: topLimit }, containerStyle]}>
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={onPanelLayout}
              style={[
                styles.panel,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.outlineVariant,
                  borderRadius: radius.lg,
                },
                fullscreen ? styles.panelFullscreen : { maxWidth: MAX_WIDTH, maxHeight: fixedHeight ?? maxHeight, height: fixedHeight },
                shadow,
                panelStyle,
              ]}>
              <View
                ref={panelRef}
                accessible={false}
                accessibilityViewIsModal
                style={[styles.panelInner, { borderRadius: radius.lg - 1 }]}>
                <SheetContext value={ctx}>{children}</SheetContext>
              </View>
            </Animated.View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// SheetContent
// ---------------------------------------------------------------------------------------------

export interface SheetContentProps {
  title?: string;
  description?: string;
  /** Grab handle at the top. Defaults to true for the bottom side, false for fullscreen. */
  showHandle?: boolean;
  /** ✕ close button in the header. Default true. */
  showClose?: boolean;
  /** Extra style for the scroll body's content container (default padding 20 / 16). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Body content. A direct <SheetFooter> child is pulled out of the scroll area and pinned at the bottom. */
  children?: ReactNode;
}

export function SheetContent({ title, description, showHandle, showClose = true, contentContainerStyle, children }: SheetContentProps) {
  const ctx = useSheet('SheetContent');
  const { colors } = useTheme();
  const handle = showHandle ?? ctx.side === 'bottom';
  const hasHeader = Boolean(title || description);

  const items = Children.toArray(children);
  const footer = items.filter((c) => isValidElement(c) && c.type === SheetFooter);
  const body = items.filter((c) => !(isValidElement(c) && c.type === SheetFooter));

  const headerBottom = ctx.headerBottom;
  const scrollY = ctx.scrollY;
  const onHeaderLayout = (e: LayoutChangeEvent) => {
    // +1 for the panel's top border.
    headerBottom.value = e.nativeEvent.layout.y + e.nativeEvent.layout.height + 1;
  };
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <>
      <View onLayout={onHeaderLayout}>
        {handle ? (
          <View style={styles.handleArea}>
            <View style={[styles.handle, { backgroundColor: colors.onSurfaceVariant }]} />
          </View>
        ) : null}
        {hasHeader ? (
          <View style={[styles.header, { paddingTop: handle ? 4 : 20, paddingRight: showClose ? 60 : 20 }]}>
            {title ? (
              <RNText ref={ctx.titleRef} accessibilityRole="header" style={[styles.title, { color: colors.onSurface }]}>
                {title}
              </RNText>
            ) : null}
            {description ? <RNText style={[styles.description, { color: colors.onSurfaceVariant }]}>{description}</RNText> : null}
          </View>
        ) : showClose ? (
          <View style={{ height: handle ? 36 : 56 }} />
        ) : null}
        {hasHeader ? <View style={[styles.hairline, { backgroundColor: colors.outlineVariant }]} /> : null}
        {showClose ? <CloseButton onPress={ctx.close} top={handle ? 10 : 8} /> : null}
      </View>
      <GestureDetector gesture={ctx.scrollGesture}>
        <Animated.ScrollView
          ref={ctx.scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          overScrollMode="never"
          bounces={false}
          keyboardShouldPersistTaps="handled"
          style={ctx.fillsHeight ? styles.fill : styles.bodyShrink}
          contentContainerStyle={[styles.body, contentContainerStyle]}>
          {body}
        </Animated.ScrollView>
      </GestureDetector>
      {footer}
    </>
  );
}

function CloseButton({ onPress, top }: { onPress: () => void; top: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={[styles.closeHit, { top }]}>
      {({ pressed }) => (
        <View style={[styles.closeVisual, { backgroundColor: pressed ? colors.surfaceContainerHigh : colors.surfaceContainer }]}>
          <MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceVariant} />
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------
// SheetClose
// ---------------------------------------------------------------------------------------------

export interface SheetCloseProps {
  /** Merge the close behaviour into the single child's `onPress` instead of wrapping it. */
  asChild?: boolean;
  children: ReactNode;
  accessibilityLabel?: string;
}

type Pressish = { onPress?: (e: GestureResponderEvent) => void };

export function SheetClose({ asChild, children, accessibilityLabel }: SheetCloseProps) {
  const { close } = useSheet('SheetClose');
  if (asChild && isValidElement<Pressish>(children)) {
    const child = children as ReactElement<Pressish>;
    const own = child.props.onPress;
    return cloneElement(child, {
      onPress: (e: GestureResponderEvent) => {
        own?.(e);
        close();
      },
    });
  }
  return (
    <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------
// SheetDetailRows / SheetFooter
// ---------------------------------------------------------------------------------------------

export interface SheetDetailRow {
  label: string;
  value: ReactNode;
}

export interface SheetDetailRowsProps {
  rows: SheetDetailRow[];
  style?: StyleProp<ViewStyle>;
}

export function SheetDetailRows({ rows, style }: SheetDetailRowsProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rows, { borderColor: colors.outlineVariant, borderRadius: radius.md }, style]}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          accessible
          style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant }]}>
          <RNText style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>{row.label}</RNText>
          {typeof row.value === 'string' || typeof row.value === 'number' ? (
            <RNText style={[styles.rowValue, { color: colors.onSurface }]}>{row.value}</RNText>
          ) : (
            row.value
          )}
        </View>
      ))}
    </View>
  );
}

export interface SheetFooterProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Sticky action area; place it as a direct child of <SheetContent>. */
export function SheetFooter({ children, style }: SheetFooterProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.footer, { borderTopColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLow }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  panel: { width: '100%', flexShrink: 1, borderWidth: 1 },
  panelFullscreen: { flex: 1 },
  panelInner: { flexShrink: 1, flexGrow: 1, overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 8 },
  handle: { width: 40, height: 5, borderRadius: 3, opacity: 0.35 },
  header: { paddingLeft: 20, paddingBottom: 14 },
  title: { fontFamily: fonts.displaySemi, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  description: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 4 },
  hairline: { height: StyleSheet.hairlineWidth },
  closeHit: { position: 'absolute', right: 8, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  closeVisual: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bodyShrink: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingVertical: 16 },
  rows: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowLabel: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  rowValue: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, flexShrink: 1, textAlign: 'right' },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
