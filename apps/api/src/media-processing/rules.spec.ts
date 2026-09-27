import { parseFfprobe } from './probe';
import { decideMediaUse, expectedVariantProbe, MediaRules, ProbeResult, validateMedia } from './rules';

const instagramRules: MediaRules = {
  containers: ['mov', 'mp4'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac'],
  audioRequired: false,
  minDurationMs: 3000,
  maxDurationMs: 900_000,
  maxSizeBytes: 300 * 1024 ** 2,
  minFps: 23,
  maxFps: 60,
  maxWidth: 1920,
  aspectRatio: { min: 0.01, max: 10 },
  allowHdr: false,
  allowVariableFrameRate: false,
  allowTenBit: false,
};

const facebookRules: MediaRules = {
  ...instagramRules,
  videoCodecs: ['h264'],
  maxDurationMs: 90_000,
  minWidth: 540,
  aspectRatio: { min: 0.5, max: 0.6 },
};

// Realistic ffprobe output from an Android phone recording: HEVC 10-bit HDR, rotated.
const pixelHdr = parseFfprobe({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 1920,
      height: 1080,
      avg_frame_rate: '30000/1001',
      r_frame_rate: '30/1',
      pix_fmt: 'yuv420p10le',
      color_transfer: 'arib-std-b67',
      color_primaries: 'bt2020',
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '21.400000', size: '48000000' },
});

const cleanSdr: ProbeResult = {
  ...pixelHdr,
  videoCodec: 'h264',
  rotation: 0,
  width: 1080,
  height: 1920,
  frameRate: 30,
  isVariableFrameRate: false,
  isHdr: false,
  bitDepth: 8,
};

describe('parseFfprobe', () => {
  it('extracts phone recording details', () => {
    expect(pixelHdr).toMatchObject({
      container: 'mp4',
      videoCodec: 'hevc',
      audioCodec: 'aac',
      hasAudio: true,
      durationMs: 21400,
      rotation: -90,
      isHdr: true,
      bitDepth: 10,
      sizeBytes: 48000000,
    });
    expect(pixelHdr.isVariableFrameRate).toBe(false);
    expect(pixelHdr.frameRate).toBeCloseTo(29.97, 2);
  });

  it('detects variable frame rate screen recordings', () => {
    const vfr = parseFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 2400, avg_frame_rate: '5421/100', r_frame_rate: '120/1', pix_fmt: 'yuv420p' }],
      format: { format_name: 'mov,mp4', duration: '10.0' },
    });
    expect(vfr.isVariableFrameRate).toBe(true);
    expect(vfr.hasAudio).toBe(false);
    expect(vfr.bitDepth).toBe(8);
  });

  it('handles missing streams', () => {
    expect(parseFfprobe({})).toMatchObject({ videoCodec: null, durationMs: null, hasAudio: false });
  });
});

describe('validateMedia', () => {
  it('accepts a clean vertical H.264 SDR video', () => {
    expect(validateMedia(cleanSdr, instagramRules, 'Instagram')).toEqual([]);
    expect(decideMediaUse(validateMedia(cleanSdr, facebookRules, 'Facebook'))).toBe('original');
  });

  it('flags HDR 10-bit as fixable by transcoding (rotation makes it vertical)', () => {
    const issues = validateMedia(pixelHdr, instagramRules, 'Instagram');
    expect(issues.map((i) => i.code).sort()).toEqual(['BIT_DEPTH', 'HDR']);
    expect(decideMediaUse(issues)).toBe('variant');
  });

  it('HEVC is not accepted by Facebook but can be transcoded', () => {
    const issues = validateMedia({ ...cleanSdr, videoCodec: 'hevc' }, facebookRules, 'Facebook');
    expect(issues.map((i) => i.code)).toEqual(['VIDEO_CODEC']);
    expect(decideMediaUse(issues)).toBe('variant');
  });

  it('a 3:10 video is too long for Facebook Reels and cannot be fixed', () => {
    const issues = validateMedia({ ...cleanSdr, durationMs: 190_000 }, facebookRules, 'Facebook');
    expect(issues).toEqual([expect.objectContaining({ code: 'DURATION_LONG', fixableByTranscode: false })]);
    expect(issues[0].message).toBe('Too long for Facebook (maximum 1 min 30s).');
    expect(decideMediaUse(issues)).toBe('incompatible');
  });

  it('a landscape video fails Facebook aspect ratio', () => {
    const issues = validateMedia({ ...cleanSdr, width: 1920, height: 1080 }, facebookRules, 'Facebook');
    expect(issues.map((i) => i.code)).toContain('ASPECT_RATIO');
    expect(decideMediaUse(issues)).toBe('incompatible');
  });

  it('too short is unfixable', () => {
    expect(decideMediaUse(validateMedia({ ...cleanSdr, durationMs: 1200 }, instagramRules, 'Instagram'))).toBe('incompatible');
  });

  it('the expected variant of an HDR phone video passes Instagram and Facebook', () => {
    const variant = expectedVariantProbe(pixelHdr);
    expect(variant).toMatchObject({ videoCodec: 'h264', isHdr: false, bitDepth: 8, width: 1080, height: 1920, rotation: 0 });
    expect(validateMedia(variant, instagramRules, 'Instagram')).toEqual([]);
    expect(validateMedia(variant, facebookRules, 'Facebook')).toEqual([]);
  });

  it('variant caps 4K to 1920 and fixes 120fps VFR to 30fps', () => {
    const variant = expectedVariantProbe({ ...cleanSdr, width: 2160, height: 3840, frameRate: 120, isVariableFrameRate: true });
    expect(variant).toMatchObject({ width: 1080, height: 1920, frameRate: 30, isVariableFrameRate: false });
  });
});
