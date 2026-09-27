import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { brand, fonts } from '@/theme/tokens';

/**
 * Stylised "how it will look" screens rendered inside a PhoneFrame. They echo each platform's
 * layout (rails, captions, cards) without copying logos; the platform is signalled by a small
 * icon badge. Sizes scale from a 220dp-wide reference screen.
 */
export interface PlatformPreviewProps {
  videoUri?: string | null;
  thumbnailUri?: string | null;
  caption: string;
  title?: string;
  accountName?: string;
  /** Only the active (centred) preview plays its video. */
  active: boolean;
  /** Screen width in dp (from the carousel's render ctx). Scales type and icons. Default 220. */
  width?: number;
}

const REF_WIDTH = 220;
const WHITE = '#FFFFFF';
const shadow: TextStyle = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };

function scaler(width = REF_WIDTH) {
  const s = width / REF_WIDTH;
  return (n: number) => Math.round(n * s * 10) / 10;
}

function handleOf(accountName?: string) {
  const base = (accountName ?? 'yourchannel').toLowerCase().replace(/[^a-z0-9._]/g, '');
  return base || 'yourchannel';
}

/** Cuts a caption to roughly `lines` lines so a trailing "… more" fits, like the real apps. */
function clip(caption: string, width: number, fontSize: number, lines: number) {
  const perLine = Math.floor(width / (fontSize * 0.52));
  const limit = perLine * lines - 8;
  const flat = caption.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return { text: flat, more: false };
  return { text: flat.slice(0, limit).trimEnd(), more: true };
}

// ---------------------------------------------------------------------------------------------
// Shared pieces

function GradientBox({ colors = brand.gradient, angle = 135, style, children }: { colors?: readonly string[]; angle?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  // Explicit size from layout: a percentage-sized Svg doesn't follow later flex re-layouts.
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View style={[{ overflow: 'hidden' }, style]} onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        // Skip no-op updates so re-layouts don't re-render the gradient.
        setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }}>
      <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
        <Defs>
          <LinearGradient id={id} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
            {colors.map((c, i) => (
              <Stop key={`${c}${i}`} offset={i / Math.max(colors.length - 1, 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

/** Vertical black fade used to keep overlay text legible on any footage. */
function Scrim({ from, to, style }: { from: number; to: number; style: StyleProp<ViewStyle> }) {
  const id = `s${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0 }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={from} />
            <Stop offset="1" stopColor="#000" stopOpacity={to} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

function Avatar({ name, size, ring }: { name?: string; size: number; ring?: string }) {
  const initial = (name ?? 'Y').trim().charAt(0).toUpperCase() || 'Y';
  return (
    <GradientBox style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 1.5 : 0, borderColor: ring }}>
      <Text style={{ color: WHITE, fontFamily: fonts.display, fontSize: size * 0.46, lineHeight: size * 0.6 }}>{initial}</Text>
    </GradientBox>
  );
}

/** Video (muted, looping, plays only when active) → thumbnail → brand placeholder. */
function PreviewMedia({ videoUri, thumbnailUri, active, iconSize }: { videoUri?: string | null; thumbnailUri?: string | null; active: boolean; iconSize: number }) {
  // Only the active (centred) preview actually decodes video. The carousel keeps all three
  // platform frames mounted for the 3D swipe effect, and instantiating a real decoder for every
  // one of them at once (same source, up to 3x concurrently) can exceed a device/emulator's
  // decoder capacity and corrupt the surface (a solid colour frame instead of the picture).
  // Inactive frames fall back to the thumbnail, or the brand placeholder if there's none.
  const source = active ? (videoUri ?? null) : null;
  const player = useVideoPlayer(source, (p) => {
    p.muted = true;
    p.loop = true;
  });
  useEffect(() => {
    if (!source) return;
    if (active) player.play();
    else player.pause();
  }, [active, player, source]);

  const showVideo = active && !!videoUri;
  if (!showVideo && !thumbnailUri) {
    return (
      <GradientBox style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ position: 'absolute', width: '140%', aspectRatio: 1, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', top: '-20%', left: '-60%' }} />
        <View style={{ position: 'absolute', width: '90%', aspectRatio: 1, borderRadius: 999, backgroundColor: 'rgba(11,10,18,0.12)', bottom: '-10%', right: '-40%' }} />
        <View style={{ width: iconSize * 2.2, height: iconSize * 2.2, borderRadius: iconSize * 1.1, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="play" size={iconSize} color={WHITE} style={{ marginLeft: iconSize * 0.1 }} />
        </View>
      </GradientBox>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      {thumbnailUri ? <Image source={{ uri: thumbnailUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
      {showVideo ? (
        // textureView so the video follows the carousel's 3D transforms and rounded clipping.
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />
      ) : null}
    </View>
  );
}

function RailItem({ icon, label, size, font }: { icon: ReactNode; label?: string; size: number; font: number }) {
  return (
    <View style={{ alignItems: 'center', gap: size * 0.12 }}>
      {icon}
      {label ? <Text style={[{ color: WHITE, fontFamily: fonts.bodySemi, fontSize: font, lineHeight: font * 1.25 }, shadow]}>{label}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// YouTube Shorts

export function ShortsPreview({ videoUri, thumbnailUri, caption, title, accountName, active, width = REF_WIDTH }: PlatformPreviewProps) {
  const px = scaler(width);
  const icon = px(22);
  const count = px(9.5);
  const heading = (title?.trim() || caption).replace(/\s+/g, ' ').trim();

  return (
    <View style={styles.fill}>
      <PreviewMedia videoUri={videoUri} thumbnailUri={thumbnailUri} active={active} iconSize={px(24)} />
      <Scrim from={0.35} to={0} style={{ top: 0, height: '16%' }} />
      {/* Tall enough to sit behind the whole right-side rail, not just the caption: a bright/white
          video frame (or a plain thumbnail) would otherwise wash out the icons above the caption. */}
      <Scrim from={0} to={0.75} style={{ bottom: 0, height: '58%' }} />

      <View style={[styles.topBar, { top: px(30), paddingHorizontal: px(10) }]}>
        <View style={[styles.row, { gap: px(4) }]}>
          <MaterialCommunityIcons name="youtube" size={px(18)} color="#FF0033" />
          <Text style={[{ color: WHITE, fontFamily: fonts.display, fontSize: px(13) }, shadow]}>Shorts</Text>
        </View>
        <View style={[styles.row, { gap: px(10) }]}>
          <Ionicons name="search" size={px(15)} color={WHITE} />
          <Ionicons name="ellipsis-vertical" size={px(14)} color={WHITE} />
        </View>
      </View>

      <View style={{ position: 'absolute', right: px(6), bottom: px(58), alignItems: 'center', gap: px(12) }}>
        <RailItem size={icon} font={count} icon={<MaterialCommunityIcons name="thumb-up" size={icon} color={WHITE} />} label="1.2K" />
        <RailItem size={icon} font={count} icon={<MaterialCommunityIcons name="thumb-down" size={icon} color={WHITE} />} label="Dislike" />
        <RailItem size={icon} font={count} icon={<MaterialCommunityIcons name="comment-text" size={icon} color={WHITE} />} label="48" />
        <RailItem size={icon} font={count} icon={<MaterialCommunityIcons name="share" size={icon} color={WHITE} />} label="Share" />
        <GradientBox style={{ width: px(24), height: px(24), borderRadius: px(6), borderWidth: 1.5, borderColor: WHITE, marginTop: px(2) }} />
      </View>

      <View style={{ position: 'absolute', left: px(10), right: px(48), bottom: px(16), gap: px(6) }}>
        <View style={[styles.row, { gap: px(6) }]}>
          <Avatar name={accountName} size={px(22)} />
          <Text numberOfLines={1} style={[{ color: WHITE, fontFamily: fonts.bodySemi, fontSize: px(10.5), flexShrink: 1 }, shadow]}>
            @{handleOf(accountName)}
          </Text>
          <View style={{ backgroundColor: WHITE, borderRadius: 999, paddingHorizontal: px(8), paddingVertical: px(3) }}>
            <Text style={{ color: '#0F0F0F', fontFamily: fonts.bodySemi, fontSize: px(9) }}>Subscribe</Text>
          </View>
        </View>
        <Text numberOfLines={2} style={[{ color: WHITE, fontFamily: fonts.bodyMedium, fontSize: px(10.5), lineHeight: px(14) }, shadow]}>
          {heading}
        </Text>
      </View>

      <View style={[styles.progressTrack, { height: px(2.5) }]}>
        <View style={{ width: '36%', height: '100%', backgroundColor: '#FF0033' }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Instagram Reels

export function ReelsPreview({ videoUri, thumbnailUri, caption, accountName, active, width = REF_WIDTH }: PlatformPreviewProps) {
  const px = scaler(width);
  const icon = px(21);
  const count = px(9.5);
  const captionSize = px(10.5);
  const clipped = clip(caption, width - px(56), captionSize, 2);
  const handle = handleOf(accountName);

  return (
    <View style={styles.fill}>
      <PreviewMedia videoUri={videoUri} thumbnailUri={thumbnailUri} active={active} iconSize={px(24)} />
      <Scrim from={0.35} to={0} style={{ top: 0, height: '16%' }} />
      {/* Tall enough to sit behind the whole right-side rail, not just the caption: a bright/white
          video frame (or a plain thumbnail) would otherwise wash out the icons above the caption. */}
      <Scrim from={0} to={0.75} style={{ bottom: 0, height: '60%' }} />

      <View style={[styles.topBar, { top: px(30), paddingHorizontal: px(12) }]}>
        <View style={[styles.row, { gap: px(5) }]}>
          <MaterialCommunityIcons name="instagram" size={px(16)} color={WHITE} />
          <Text style={[{ color: WHITE, fontFamily: fonts.display, fontSize: px(15) }, shadow]}>Reels</Text>
          <Ionicons name="chevron-down" size={px(11)} color={WHITE} />
        </View>
        <Ionicons name="camera-outline" size={px(18)} color={WHITE} />
      </View>

      <View style={{ position: 'absolute', right: px(8), bottom: px(20), alignItems: 'center', gap: px(13) }}>
        <RailItem size={icon} font={count} icon={<Ionicons name="heart-outline" size={icon} color={WHITE} />} label="2.4K" />
        <RailItem size={icon} font={count} icon={<Ionicons name="chatbubble-outline" size={icon * 0.92} color={WHITE} style={{ transform: [{ scaleX: -1 }] }} />} label="86" />
        <RailItem size={icon} font={count} icon={<Ionicons name="paper-plane-outline" size={icon * 0.92} color={WHITE} />} label="31" />
        <RailItem size={icon} font={count} icon={<Ionicons name="ellipsis-horizontal" size={icon * 0.8} color={WHITE} />} />
        <GradientBox style={{ width: px(20), height: px(20), borderRadius: px(5), borderWidth: 1.5, borderColor: WHITE }} />
      </View>

      <View style={{ position: 'absolute', left: px(10), right: px(44), bottom: px(16), gap: px(6) }}>
        <View style={[styles.row, { gap: px(6) }]}>
          <Avatar name={accountName} size={px(22)} ring={WHITE} />
          <Text numberOfLines={1} style={[{ color: WHITE, fontFamily: fonts.bodySemi, fontSize: px(10.5), flexShrink: 1 }, shadow]}>
            {handle}
          </Text>
          <View style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)', borderRadius: px(6), paddingHorizontal: px(7), paddingVertical: px(2) }}>
            <Text style={{ color: WHITE, fontFamily: fonts.bodySemi, fontSize: px(9) }}>Follow</Text>
          </View>
        </View>
        <Text style={[{ color: WHITE, fontFamily: fonts.body, fontSize: captionSize, lineHeight: px(14) }, shadow]}>
          {clipped.text}
          {clipped.more ? <Text style={{ color: 'rgba(255,255,255,0.7)' }}>… more</Text> : null}
        </Text>
        <View style={[styles.row, { gap: px(5) }]}>
          <Ionicons name="musical-notes" size={px(10)} color={WHITE} />
          <Text numberOfLines={1} style={[{ color: WHITE, fontFamily: fonts.body, fontSize: px(9.5), flexShrink: 1 }, shadow]}>
            {handle} · Original audio
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Facebook

const FB_BLUE = '#1877F2';
const FB_TEXT = '#1C1E21';
const FB_MUTED = '#65676B';

export function FacebookPreview({ videoUri, thumbnailUri, caption, accountName, active, width = REF_WIDTH }: PlatformPreviewProps) {
  const px = scaler(width);
  const name = accountName?.trim() || 'Your Page';
  const captionSize = px(10.5);
  const clipped = clip(caption, width - px(20), captionSize, 3);

  return (
    <View style={[styles.fill, { backgroundColor: '#F0F2F5' }]}>
      <View style={{ backgroundColor: WHITE, paddingTop: px(34), paddingBottom: px(8), paddingHorizontal: px(10), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={[styles.row, { gap: px(5) }]}>
          <MaterialCommunityIcons name="facebook" size={px(18)} color={FB_BLUE} />
          <Text style={{ color: FB_TEXT, fontFamily: fonts.display, fontSize: px(13) }}>Feed</Text>
        </View>
        <View style={[styles.row, { gap: px(6) }]}>
          {(['search', 'chatbubble-ellipses'] as const).map((n) => (
            <View key={n} style={{ width: px(22), height: px(22), borderRadius: px(11), backgroundColor: '#E4E6EB', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={n} size={px(12)} color={FB_TEXT} />
            </View>
          ))}
        </View>
      </View>

      <View style={{ flex: 1, backgroundColor: WHITE, marginTop: px(6) }}>
        <View style={[styles.row, { paddingHorizontal: px(10), paddingTop: px(9), gap: px(7) }]}>
          <Avatar name={name} size={px(26)} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: FB_TEXT, fontFamily: fonts.bodySemi, fontSize: px(10.5), lineHeight: px(14) }}>
              {name}
            </Text>
            <View style={[styles.row, { gap: px(3) }]}>
              <Text style={{ color: FB_MUTED, fontFamily: fonts.body, fontSize: px(8.5), lineHeight: px(12) }}>Just now ·</Text>
              <Ionicons name="earth" size={px(8.5)} color={FB_MUTED} />
            </View>
          </View>
          <Ionicons name="ellipsis-horizontal" size={px(13)} color={FB_MUTED} />
        </View>

        <Text style={{ color: FB_TEXT, fontFamily: fonts.body, fontSize: captionSize, lineHeight: px(14), paddingHorizontal: px(10), paddingTop: px(7), paddingBottom: px(8) }}>
          {clipped.text}
          {clipped.more ? <Text style={{ color: FB_MUTED, fontFamily: fonts.bodySemi }}>… See more</Text> : null}
        </Text>

        {/* 9:16 video; flexes to the room left on the screen, like a feed you'd keep scrolling. */}
        <View style={{ flex: 1, backgroundColor: '#000', overflow: 'hidden' }}>
          <PreviewMedia videoUri={videoUri} thumbnailUri={thumbnailUri} active={active} iconSize={px(22)} />
          <View style={[styles.badge, { top: px(8), left: px(8), paddingHorizontal: px(6), paddingVertical: px(2), gap: px(3) }]}>
            <MaterialCommunityIcons name="movie-open-play" size={px(10)} color={WHITE} />
            <Text style={{ color: WHITE, fontFamily: fonts.bodySemi, fontSize: px(8) }}>Reel</Text>
          </View>
        </View>

        <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: px(10), paddingVertical: px(6) }]}>
          <View style={styles.row}>
            <View style={[styles.reaction, { width: px(14), height: px(14), borderRadius: px(7), backgroundColor: FB_BLUE }]}>
              <MaterialCommunityIcons name="thumb-up" size={px(8)} color={WHITE} />
            </View>
            <View style={[styles.reaction, { width: px(14), height: px(14), borderRadius: px(7), backgroundColor: '#F33E58', marginLeft: -px(3) }]}>
              <MaterialCommunityIcons name="heart" size={px(8)} color={WHITE} />
            </View>
            <Text style={{ color: FB_MUTED, fontFamily: fonts.body, fontSize: px(9), marginLeft: px(4) }}>128</Text>
          </View>
          <Text style={{ color: FB_MUTED, fontFamily: fonts.body, fontSize: px(9) }}>12 comments · 4 shares</Text>
        </View>
        <View style={[styles.row, { justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#CED0D4', marginHorizontal: px(10), paddingTop: px(6), paddingBottom: px(12) }]}>
          {(
            [
              ['thumbs-up-outline', 'Like'],
              ['chatbubble-outline', 'Comment'],
              ['arrow-redo-outline', 'Share'],
            ] as const
          ).map(([n, label]) => (
            <View key={label} style={[styles.row, { gap: px(4) }]}>
              <Ionicons name={n} size={px(12)} color={FB_MUTED} />
              <Text style={{ color: FB_MUTED, fontFamily: fonts.bodySemi, fontSize: px(9) }}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  row: { flexDirection: 'row', alignItems: 'center' },
  topBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.3)' },
  badge: { position: 'absolute', flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' },
  reaction: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: WHITE },
});
