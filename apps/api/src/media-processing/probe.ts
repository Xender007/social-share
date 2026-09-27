import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProbeResult } from './rules';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  color_primaries?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number; side_data_type?: string }>;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; size?: string };
}

const parseRate = (rate: string | undefined): number | null => {
  if (!rate) return null;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 1000) / 1000;
};

const bitDepthOf = (stream: FfprobeStream): number | null => {
  if (stream.bits_per_raw_sample && Number(stream.bits_per_raw_sample) > 0) return Number(stream.bits_per_raw_sample);
  const match = stream.pix_fmt?.match(/p(\d{2})(le|be)?$/);
  if (match) return Number(match[1]);
  return stream.pix_fmt ? 8 : null;
};

/** Normalizes ffprobe JSON (from `-show_format -show_streams`) into a ProbeResult. */
export function parseFfprobe(output: FfprobeOutput): ProbeResult {
  const video = output.streams?.find((s) => s.codec_type === 'video');
  const audio = output.streams?.find((s) => s.codec_type === 'audio');
  const formatNames = (output.format?.format_name ?? '').split(',').filter(Boolean);

  const avg = parseRate(video?.avg_frame_rate);
  const real = parseRate(video?.r_frame_rate);
  const isVariableFrameRate = avg !== null && real !== null && Math.abs(avg - real) / real > 0.02;

  const sideRotation = video?.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation;
  const tagRotation = video?.tags?.rotate ? Number(video.tags.rotate) : undefined;
  const rotation = sideRotation ?? tagRotation ?? 0;

  const transfer = video?.color_transfer ?? '';
  const isHdr = transfer === 'smpte2084' || transfer === 'arib-std-b67' || video?.color_primaries === 'bt2020';

  const duration = output.format?.duration ? Number(output.format.duration) : NaN;
  const size = output.format?.size ? Number(output.format.size) : NaN;

  return {
    container: formatNames.includes('mp4') ? 'mp4' : (formatNames[0] ?? null),
    formatNames,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    width: video?.width ?? null,
    height: video?.height ?? null,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    frameRate: avg ?? real,
    isVariableFrameRate,
    isHdr,
    bitDepth: video ? bitDepthOf(video) : null,
    sizeBytes: Number.isFinite(size) ? size : null,
  };
}

/** Runs ffprobe against a local path or a signed URL (ffprobe reads HTTP ranges). */
export async function runFfprobe(ffprobePath: string, input: string, timeoutMs = 60_000): Promise<FfprobeOutput> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input],
    { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
  );
  return JSON.parse(stdout) as FfprobeOutput;
}
