import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/** Device aspect ratio (height / width) of a modern tall phone, ~9:19.5. */
export const PHONE_ASPECT = 19.5 / 9;

export interface PhoneFrameProps {
  /** Outer width of the device, bezel included. The height follows `PHONE_ASPECT`. */
  width: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Body colour: 'dark' (graphite, default) or 'light' (silver). The screen is always black. */
  tone?: 'dark' | 'light';
  /** Faint diagonal glass reflection over the screen. Default true. */
  glare?: boolean;
}

const TONES = {
  dark: { body: '#1A1824', rim: '#050409', button: '#26232F', edgeHi: 'rgba(255,255,255,0.42)', edgeLo: 'rgba(255,255,255,0.06)' },
  light: { body: '#DCD8E6', rim: '#0B0A12', button: '#C9C4D6', edgeHi: 'rgba(255,255,255,0.95)', edgeLo: 'rgba(90,84,120,0.25)' },
} as const;

/** Geometry shared with the carousel so it can size things around the device. */
export function phoneMetrics(width: number) {
  const height = Math.round(width * PHONE_ASPECT);
  const radius = width * 0.14;
  const bezel = Math.max(4, Math.round(width * 0.035));
  return { width, height, radius, bezel, screenWidth: width - bezel * 2, screenHeight: height - bezel * 2, screenRadius: Math.max(radius - bezel, 4) };
}

/**
 * A stylised modern phone drawn with Views + SVG (no images): rounded bezel with a lit edge,
 * punch-hole camera, side buttons and a clipped screen that hosts `children`.
 */
export function PhoneFrame({ width, children, style, tone = 'dark', glare = true }: PhoneFrameProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const m = phoneMetrics(width);
  const t = TONES[tone];
  const cam = Math.max(6, Math.round(width * 0.05));

  return (
    <View style={[{ width: m.width, height: m.height }, style]}>
      {/* Side buttons sit just outside the body so they read as hardware. */}
      <View style={[styles.button, { backgroundColor: t.button, right: -2, top: m.height * 0.2, height: m.height * 0.075 }]} />
      <View style={[styles.button, { backgroundColor: t.button, right: -2, top: m.height * 0.31, height: m.height * 0.13 }]} />

      <View style={[StyleSheet.absoluteFill, { borderRadius: m.radius, backgroundColor: t.body }]} />
      {/* Inner black rim between body and glass. */}
      <View
        style={{
          position: 'absolute',
          left: m.bezel * 0.45,
          top: m.bezel * 0.45,
          right: m.bezel * 0.45,
          bottom: m.bezel * 0.45,
          borderRadius: m.radius - m.bezel * 0.45,
          backgroundColor: t.rim,
        }}
      />

      <View
        style={{
          position: 'absolute',
          left: m.bezel,
          top: m.bezel,
          width: m.screenWidth,
          height: m.screenHeight,
          borderRadius: m.screenRadius,
          overflow: 'hidden',
          backgroundColor: '#000',
        }}>
        {children}
        {glare ? (
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id={`glare${uid}`} x1="0" y1="0" x2="1" y2="0.6">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.1} />
                <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity={0.02} />
                <Stop offset="0.451" stopColor="#FFFFFF" stopOpacity={0} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width="100%" height="100%" fill={`url(#glare${uid})`} />
          </Svg>
        ) : null}
        {/* Punch-hole camera with a hint of lens. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: Math.round(m.screenHeight * 0.018),
            alignSelf: 'center',
            width: cam,
            height: cam,
            borderRadius: cam / 2,
            backgroundColor: '#050409',
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: '#1E2230',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View style={{ width: cam * 0.28, height: cam * 0.28, borderRadius: cam, backgroundColor: '#2B3450', marginLeft: cam * 0.18, marginTop: -cam * 0.18 }} />
        </View>
      </View>

      {/* Lit edge: brighter top-left, fading toward bottom-right. */}
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={m.width} height={m.height}>
        <Defs>
          <LinearGradient id={`edge${uid}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.edgeHi} />
            <Stop offset="0.5" stopColor={t.edgeLo} />
            <Stop offset="1" stopColor={t.edgeHi} stopOpacity={0.5} />
          </LinearGradient>
        </Defs>
        <Rect
          x={0.75}
          y={0.75}
          width={m.width - 1.5}
          height={m.height - 1.5}
          rx={m.radius - 0.75}
          ry={m.radius - 0.75}
          fill="none"
          stroke={`url(#edge${uid})`}
          strokeWidth={1.5}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { position: 'absolute', width: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
});
