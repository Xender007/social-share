import type { ValidationIssueView } from '@sp/contracts';

/** Result of ffprobe, normalized to what validation needs. */
export interface ProbeResult {
  container: string | null;
  formatNames: string[];
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  rotation: number;
  durationMs: number | null;
  frameRate: number | null;
  isVariableFrameRate: boolean;
  isHdr: boolean;
  bitDepth: number | null;
  sizeBytes: number | null;
}

export interface MediaRules {
  containers: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  audioRequired: boolean;
  minDurationMs: number;
  maxDurationMs: number;
  maxSizeBytes: number;
  minFps?: number;
  maxFps?: number;
  maxWidth?: number;
  minWidth?: number;
  aspectRatio?: { min: number; max: number };
  allowHdr: boolean;
  allowVariableFrameRate: boolean;
  allowTenBit: boolean;
}

export type ValidationIssue = ValidationIssueView;

/** Display dimensions after applying rotation metadata (phones often record rotated). */
export function effectiveDimensions(probe: ProbeResult): { width: number | null; height: number | null } {
  const rotated = Math.abs(probe.rotation) % 180 === 90;
  return rotated ? { width: probe.height, height: probe.width } : { width: probe.width, height: probe.height };
}

const seconds = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`);
const formatDuration = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min${ms % 60_000 ? ` ${seconds(ms % 60_000)}` : ''}` : seconds(ms));
const megabytes = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(0)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

/**
 * Checks a probed video against one platform's rules (§15.4).
 * Issues that a normalized H.264 SDR variant would fix are marked `fixableByTranscode`;
 * duration and aspect ratio are never auto-fixed (we don't trim or crop user videos).
 */
export function validateMedia(probe: ProbeResult, rules: MediaRules, platformName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, fixableByTranscode: boolean, message: string) => issues.push({ code, fixableByTranscode, message });

  if (!probe.formatNames.some((name) => rules.containers.includes(name))) {
    add('CONTAINER', true, `${platformName} needs ${rules.containers.join('/').toUpperCase()} video files.`);
  }
  if (!probe.videoCodec || !rules.videoCodecs.includes(probe.videoCodec)) {
    add('VIDEO_CODEC', true, `${platformName} doesn't accept ${probe.videoCodec ?? 'this'} video encoding.`);
  }
  if (probe.hasAudio && probe.audioCodec && !rules.audioCodecs.includes(probe.audioCodec)) {
    add('AUDIO_CODEC', true, `${platformName} doesn't accept ${probe.audioCodec} audio.`);
  }
  if (rules.audioRequired && !probe.hasAudio) {
    add('NO_AUDIO', false, `${platformName} requires the video to have sound.`);
  }
  if (probe.durationMs !== null) {
    if (probe.durationMs < rules.minDurationMs) {
      add('DURATION_SHORT', false, `Too short for ${platformName} (minimum ${formatDuration(rules.minDurationMs)}).`);
    }
    if (probe.durationMs > rules.maxDurationMs) {
      add('DURATION_LONG', false, `Too long for ${platformName} (maximum ${formatDuration(rules.maxDurationMs)}).`);
    }
  }
  if (probe.sizeBytes !== null && probe.sizeBytes > rules.maxSizeBytes) {
    add('FILE_TOO_LARGE', true, `File is larger than ${platformName} allows (${megabytes(rules.maxSizeBytes)}).`);
  }
  if (probe.frameRate !== null) {
    if (rules.maxFps !== undefined && probe.frameRate > rules.maxFps + 0.5) {
      add('FPS', true, `${platformName} supports up to ${rules.maxFps} fps.`);
    }
    if (rules.minFps !== undefined && probe.frameRate < rules.minFps - 0.5) {
      add('FPS', true, `${platformName} needs at least ${rules.minFps} fps.`);
    }
  }
  const { width, height } = effectiveDimensions(probe);
  if (width !== null && height !== null && height > 0) {
    const longest = Math.max(width, height);
    if (rules.maxWidth !== undefined && longest > rules.maxWidth) {
      add('RESOLUTION', true, `${platformName} supports up to ${rules.maxWidth}px.`);
    }
    if (rules.minWidth !== undefined && Math.min(width, height) < rules.minWidth) {
      add('RESOLUTION', false, `Resolution is too low for ${platformName} (minimum ${rules.minWidth}px wide).`);
    }
    const ratio = width / height;
    if (rules.aspectRatio && (ratio < rules.aspectRatio.min || ratio > rules.aspectRatio.max)) {
      add('ASPECT_RATIO', false, `${platformName} needs a vertical 9:16 video.`);
    }
  }
  if (probe.isHdr && !rules.allowHdr) add('HDR', true, `${platformName} doesn't handle HDR video well.`);
  if (probe.isVariableFrameRate && !rules.allowVariableFrameRate) add('VFR', true, `${platformName} needs a constant frame rate.`);
  if ((probe.bitDepth ?? 8) > 8 && !rules.allowTenBit) add('BIT_DEPTH', true, `${platformName} needs 8-bit video.`);

  return issues;
}

export type MediaDecision = 'original' | 'variant' | 'incompatible';

export function decideMediaUse(issues: ValidationIssue[]): MediaDecision {
  if (issues.length === 0) return 'original';
  return issues.every((issue) => issue.fixableByTranscode) ? 'variant' : 'incompatible';
}

/** What the normalized H.264 SDR variant will look like, so we can pre-validate it. */
export function expectedVariantProbe(probe: ProbeResult): ProbeResult {
  const { width, height } = effectiveDimensions(probe);
  const scale = width && height && Math.max(width, height) > 1920 ? 1920 / Math.max(width, height) : 1;
  const fps = probe.frameRate && !probe.isVariableFrameRate && probe.frameRate >= 24 && probe.frameRate <= 60 ? probe.frameRate : 30;
  return {
    ...probe,
    container: 'mp4',
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    audioCodec: probe.hasAudio ? 'aac' : null,
    width: width ? Math.round((width * scale) / 2) * 2 : null,
    height: height ? Math.round((height * scale) / 2) * 2 : null,
    rotation: 0,
    frameRate: fps,
    isVariableFrameRate: false,
    isHdr: false,
    bitDepth: 8,
    sizeBytes: null,
  };
}
