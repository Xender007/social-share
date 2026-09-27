import type { ProbeResult } from './rules';

/**
 * ffmpeg arguments for the normalized H.264 SDR variant (§15.5).
 * - HDR input is tone-mapped to BT.709 (needs an ffmpeg build with zscale).
 * - Longest side capped at 1920 with even dimensions; rotation is applied by ffmpeg's autorotate.
 * - Frame rate kept when constant and 24–60, otherwise forced to 30.
 * - Closed, regular GOP and faststart for provider-side processing.
 */
export function buildTranscodeArgs(probe: ProbeResult, input: string, output: string): string[] {
  const filters: string[] = [];
  if (probe.isHdr) {
    filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  }
  filters.push("scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'");
  const fps = probe.frameRate ?? 0;
  if (probe.isVariableFrameRate || fps > 60.5 || fps < 23.5) filters.push('fps=30');
  filters.push('format=yuv420p');

  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-g',
    '60',
    '-keyint_min',
    '60',
    '-sc_threshold',
    '0',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  ];
}
