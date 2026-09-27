import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GradientFill } from '@/components/ui/gradient';
import { ProgressBar } from '@/components/ui/feedback';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import type { DraftVideo } from '@/stores/draft';

function VideoPreview({ video }: { video: DraftVideo }) {
  const player = useVideoPlayer(video.uri, (p) => {
    p.muted = true;
    p.loop = true;
  });
  return <VideoView player={player} style={styles.video} contentFit="contain" nativeControls accessibilityLabel={`Preview of ${video.fileName}`} />;
}

function MetaChip({ icon, label }: { icon: 'timer-outline' | 'aspect-ratio'; label: string }) {
  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons name={icon} size={13} color="#FFFFFF" />
      <Text role="labelMedium" style={styles.chipText}>
        {label}
      </Text>
    </View>
  );
}

/** Large dashed picker tile shown before any video has been chosen. */
export function VideoPickerTile({ onPick }: { onPick: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel="Choose a video"
      accessibilityHint="Opens your gallery to pick a video, or share one into Social Publisher from any app."
      style={[styles.tile, { borderColor: colors.outline, backgroundColor: colors.surfaceContainerLow }]}>
      <View style={styles.tileIcon}>
        <GradientFill borderRadius={999} />
        <MaterialCommunityIcons name="video-plus-outline" size={30} color="#FFFFFF" />
      </View>
      <Text role="titleMedium" align="center">
        Choose a video
      </Text>
      <Text role="bodyMedium" color="onSurfaceVariant" align="center" style={styles.tileHint}>
        Pick a video from your gallery, or share one into Social Publisher from any app.
      </Text>
    </PressableScale>
  );
}

export interface VideoStepProps {
  video: DraftVideo;
  durationLabel: string;
  sizeLabel: string;
  isHdr: boolean;
  resolutionLabel: string | null;
  uploadStatus: 'idle' | 'uploading' | 'processing' | 'ready' | 'error';
  uploadProgress: number;
  uploadLabel: string;
  onChangeVideo: () => void;
  onRetryUpload: () => void;
}

/** Rounded video preview (PhoneFrame-like) with duration/resolution chips, plus upload progress. */
export function VideoStep({ video, durationLabel, sizeLabel, isHdr, resolutionLabel, uploadStatus, uploadProgress, uploadLabel, onChangeVideo, onRetryUpload }: VideoStepProps) {
  const { colors } = useTheme();
  return (
    <Card variant="outlined" style={styles.videoCard}>
      <View style={styles.videoFrame}>
        <VideoPreview video={video} />
        <View style={styles.chipRow} pointerEvents="none">
          {durationLabel ? <MetaChip icon="timer-outline" label={durationLabel} /> : null}
          {resolutionLabel ? <MetaChip icon="aspect-ratio" label={resolutionLabel} /> : null}
        </View>
      </View>
      <View style={styles.videoMeta}>
        <View style={styles.flex}>
          <Text role="titleSmall" numberOfLines={1}>
            {video.fileName}
          </Text>
          <Text role="bodySmall" color="onSurfaceVariant">
            {[sizeLabel, isHdr ? 'HDR' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Button label="Change" variant="text" onPress={onChangeVideo} />
      </View>
      <View style={styles.uploadRow}>
        <Text role="labelMedium" color={uploadStatus === 'error' ? 'error' : 'onSurfaceVariant'} accessibilityLiveRegion="polite" style={styles.flex}>
          {uploadLabel}
        </Text>
        {uploadStatus === 'ready' ? <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} /> : null}
      </View>
      {uploadStatus === 'uploading' || uploadStatus === 'processing' ? (
        <View style={styles.progressBlock}>
          <ProgressBar progress={uploadStatus === 'processing' ? 1 : uploadProgress} label="Upload progress" />
          <Text role="labelMedium" color="onSurfaceVariant" align="right">
            {Math.round((uploadStatus === 'processing' ? 1 : uploadProgress) * 100)}%
          </Text>
        </View>
      ) : null}
      {uploadStatus === 'error' ? <Button label="Retry upload" variant="tonal" icon="refresh" onPress={onRetryUpload} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tile: {
    minHeight: 220,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  tileIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileHint: { maxWidth: 280 },
  videoCard: { gap: 12 },
  videoFrame: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  video: { width: '100%', height: 260, backgroundColor: '#000' },
  chipRow: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: '#FFFFFF' },
  videoMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressBlock: { gap: 4 },
});
