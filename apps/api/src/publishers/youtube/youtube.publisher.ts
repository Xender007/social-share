import { Readable } from 'node:stream';
import type { MediaRules, ProbeResult, ValidationIssue } from '../../media-processing/rules';
import { effectiveDimensions } from '../../media-processing/rules';
import { httpJson, HttpResult, msUntilPacificMidnight, retryAfterMs } from '../http';
import { effectiveYoutubeTitle, textIssues, youtubeOptionsSchema } from '../option-schemas';
import {
  ClassifiedError,
  classifyUnknownError,
  ProviderError,
  PublishContext,
  ReconcileResult,
  SocialPublisher,
  StepResult,
} from '../types';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const CHUNK_BYTES = 8 * 1024 * 1024; // must be a multiple of 256 KiB

interface YtCheckpoint {
  sessionUri?: string;
  videoId?: string;
}

interface YtErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> };
}

interface YtVideo {
  id: string;
  status?: { uploadStatus?: string; failureReason?: string; rejectionReason?: string; privacyStatus?: string };
  processingDetails?: { processingStatus?: string };
}

/** Maps a YouTube API error response to a classified provider error (§20.6). */
export function youtubeError(res: HttpResult<YtErrorBody>, step: string): ProviderError {
  const reason = res.body?.error?.errors?.[0]?.reason ?? '';
  const message = res.body?.error?.message ?? res.text.slice(0, 200);
  const base = { httpStatus: res.status, providerCode: reason || String(res.status) };

  if (res.status === 401) {
    return new ProviderError({ ...base, category: 'AUTH', code: 'YT_REAUTH', userMessage: 'Reconnect YouTube to continue publishing.', requestHadNoEffect: true });
  }
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new ProviderError({ ...base, category: 'RATE_LIMITED', code: 'YT_QUOTA_EXCEEDED', userMessage: 'YouTube daily upload quota reached. Will retry after it resets.', retryAfterMs: msUntilPacificMidnight(), requestHadNoEffect: true });
  }
  if (reason === 'uploadLimitExceeded') {
    return new ProviderError({ ...base, category: 'PROVIDER_LIMIT', code: 'YT_UPLOAD_LIMIT', userMessage: 'This channel reached its YouTube upload limit.', retryAfterMs: 24 * 3_600_000, requestHadNoEffect: true });
  }
  if (res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new ProviderError({ ...base, category: 'RATE_LIMITED', code: 'YT_RATE_LIMITED', userMessage: 'YouTube is rate limiting uploads. Will retry shortly.', retryAfterMs: retryAfterMs(res.headers, 60_000), requestHadNoEffect: true });
  }
  if (res.status === 403) {
    return new ProviderError({ ...base, category: 'PERMISSION', code: 'YT_FORBIDDEN', userMessage: `YouTube refused the upload: ${message}`, requestHadNoEffect: true });
  }
  if (res.status === 400) {
    return new ProviderError({ ...base, category: 'VALIDATION', code: 'YT_INVALID_REQUEST', userMessage: `YouTube rejected the video details: ${message}`, requestHadNoEffect: true });
  }
  if (res.status >= 500) {
    return new ProviderError({ ...base, category: 'TRANSIENT', code: 'YT_BACKEND', userMessage: 'YouTube had a temporary problem. Will retry.', requestHadNoEffect: step !== 'UPLOAD_BYTES' });
  }
  return new ProviderError({ ...base, category: 'INTERNAL', code: 'YT_UNEXPECTED', userMessage: `Unexpected YouTube response (${res.status}).`, requestHadNoEffect: step !== 'UPLOAD_BYTES' });
}

export class YouTubePublisher implements SocialPublisher {
  readonly platformCode = 'youtube';
  readonly initialStep = 'INIT_SESSION';
  readonly nonIdempotentSteps = new Set(['UPLOAD_BYTES']);
  readonly optionsSchema = youtubeOptionsSchema;

  validate(_probe: ProbeResult, text: { title?: string; caption?: string }, _rules: MediaRules): ValidationIssue[] {
    return textIssues(this.platformCode, text);
  }

  async runStep(step: string, ctx: PublishContext): Promise<StepResult> {
    const cp = ctx.checkpoint as YtCheckpoint;
    switch (step) {
      case 'INIT_SESSION':
        return { kind: 'advance', nextStep: 'UPLOAD_BYTES', checkpoint: { sessionUri: await this.initSession(ctx), videoId: undefined } };
      case 'UPLOAD_BYTES': {
        let sessionUri = cp.sessionUri ?? (await this.initSession(ctx));
        let status = await this.querySession(ctx, sessionUri);
        if (status.kind === 'expired') {
          sessionUri = await this.initSession(ctx);
          status = { kind: 'incomplete', nextByte: 0 };
        }
        const videoId = status.kind === 'complete' ? status.videoId : await this.uploadFrom(ctx, sessionUri, status.nextByte);
        return { kind: 'advance', nextStep: 'WAIT_PROCESSING', checkpoint: { sessionUri, videoId } };
      }
      case 'WAIT_PROCESSING': {
        if (!cp.videoId) return { kind: 'advance', nextStep: 'UPLOAD_BYTES' };
        const video = await this.getVideo(ctx, cp.videoId);
        if (!video) return { kind: 'wait', step: 'WAIT_PROCESSING', pollAfterMs: 15_000 };
        const upload = video.status?.uploadStatus;
        if (upload === 'rejected' || upload === 'failed' || video.processingDetails?.processingStatus === 'failed') {
          throw new ProviderError({
            category: 'MEDIA_INVALID',
            code: 'YT_PROCESSING_FAILED',
            providerCode: video.status?.rejectionReason ?? video.status?.failureReason ?? upload,
            userMessage: `YouTube couldn't process this video (${video.status?.rejectionReason ?? video.status?.failureReason ?? 'processing failed'}).`,
            requestHadNoEffect: true,
          });
        }
        if (upload === 'processed' || video.processingDetails?.processingStatus === 'succeeded') {
          return { kind: 'done', externalId: cp.videoId, externalUrl: this.videoUrl(cp.videoId, ctx.media.probe) };
        }
        return { kind: 'wait', step: 'WAIT_PROCESSING' };
      }
      default:
        throw new Error(`Unknown YouTube step ${step}`);
    }
  }

  async reconcile(ctx: PublishContext): Promise<ReconcileResult> {
    const cp = ctx.checkpoint as YtCheckpoint;
    if (cp.videoId) {
      const video = await this.getVideo(ctx, cp.videoId);
      if (!video) return { kind: 'not_published', resumeFromStep: 'INIT_SESSION', checkpoint: { videoId: undefined, sessionUri: undefined } };
      if (video.status?.uploadStatus === 'processed') return { kind: 'published', externalId: cp.videoId, externalUrl: this.videoUrl(cp.videoId, ctx.media.probe) };
      return { kind: 'in_progress', step: 'WAIT_PROCESSING' };
    }
    if (cp.sessionUri) {
      const status = await this.querySession(ctx, cp.sessionUri);
      if (status.kind === 'complete') return { kind: 'in_progress', step: 'WAIT_PROCESSING', checkpoint: { videoId: status.videoId } };
      if (status.kind === 'incomplete') return { kind: 'not_published', resumeFromStep: 'UPLOAD_BYTES' };
    }
    return { kind: 'not_published', resumeFromStep: 'INIT_SESSION', checkpoint: { sessionUri: undefined } };
  }

  classifyError(error: unknown, _step: string, meta: { nonIdempotent: boolean }): ClassifiedError {
    return classifyUnknownError(error, meta.nonIdempotent);
  }

  stepTimeoutMs(step: string): number {
    return step === 'UPLOAD_BYTES' ? 30 * 60_000 : 60_000;
  }

  maxWaitMs(): number {
    return 6 * 3_600_000;
  }

  private async auth(ctx: PublishContext): Promise<string> {
    return `Bearer ${(await ctx.credentials()).accessToken}`;
  }

  private async initSession(ctx: PublishContext): Promise<string> {
    const options = this.optionsSchema.parse(ctx.options);
    const res = await httpJson<YtErrorBody>(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: await this.auth(ctx),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(ctx.media.sizeBytes),
        'X-Upload-Content-Type': ctx.media.contentType,
      },
      body: JSON.stringify({
        snippet: { title: effectiveYoutubeTitle(ctx.text), description: ctx.text.caption ?? '', categoryId: options.categoryId },
        status: { privacyStatus: options.privacyStatus, selfDeclaredMadeForKids: options.madeForKids, embeddable: true },
      }),
      signal: ctx.signal,
    });
    const location = res.headers.get('location');
    if (res.status !== 200 || !location) throw youtubeError(res, 'INIT_SESSION');
    return location;
  }

  private async querySession(ctx: PublishContext, sessionUri: string): Promise<{ kind: 'complete'; videoId: string } | { kind: 'incomplete'; nextByte: number } | { kind: 'expired' }> {
    const res = await httpJson<YtVideo & YtErrorBody>(sessionUri, {
      method: 'PUT',
      headers: { Authorization: await this.auth(ctx), 'Content-Length': '0', 'Content-Range': `bytes */${ctx.media.sizeBytes}` },
      signal: ctx.signal,
    });
    if (res.status === 200 || res.status === 201) return { kind: 'complete', videoId: res.body.id };
    if (res.status === 308) return { kind: 'incomplete', nextByte: this.nextByteFromRange(res.headers.get('range')) };
    if (res.status === 404 || res.status === 410) return { kind: 'expired' };
    throw youtubeError(res, 'UPLOAD_BYTES');
  }

  private nextByteFromRange(range: string | null): number {
    const match = range?.match(/bytes=0-(\d+)/);
    return match ? Number(match[1]) + 1 : 0;
  }

  private async uploadFrom(ctx: PublishContext, sessionUri: string, startByte: number): Promise<string> {
    const total = ctx.media.sizeBytes;
    let offset = startByte;
    while (offset < total) {
      const end = Math.min(offset + CHUNK_BYTES, total) - 1;
      const stream = await ctx.media.openRange(offset, end);
      const res = await httpJson<YtVideo & YtErrorBody>(sessionUri, {
        method: 'PUT',
        headers: {
          Authorization: await this.auth(ctx),
          'Content-Length': String(end - offset + 1),
          'Content-Range': `bytes ${offset}-${end}/${total}`,
          'Content-Type': ctx.media.contentType,
        },
        body: Readable.toWeb(stream) as unknown as RequestInit['body'],
        duplex: 'half',
        timeoutMs: 10 * 60_000,
        signal: ctx.signal,
      } as RequestInit & { duplex: 'half'; timeoutMs: number });
      if (res.status === 200 || res.status === 201) return res.body.id;
      if (res.status === 308) {
        offset = this.nextByteFromRange(res.headers.get('range'));
        continue;
      }
      throw youtubeError(res, 'UPLOAD_BYTES');
    }
    const final = await this.querySession(ctx, sessionUri);
    if (final.kind === 'complete') return final.videoId;
    throw new ProviderError({ category: 'TRANSIENT', code: 'YT_UPLOAD_INCOMPLETE', userMessage: 'Upload to YouTube did not complete. Will resume.', requestHadNoEffect: true });
  }

  private async getVideo(ctx: PublishContext, videoId: string): Promise<YtVideo | null> {
    const res = await httpJson<{ items?: YtVideo[] } & YtErrorBody>(`${VIDEOS_URL}?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, {
      headers: { Authorization: await this.auth(ctx) },
      signal: ctx.signal,
    });
    if (res.status !== 200) throw youtubeError(res, 'WAIT_PROCESSING');
    return res.body.items?.[0] ?? null;
  }

  private videoUrl(videoId: string, probe: ProbeResult): string {
    const { width, height } = effectiveDimensions(probe);
    const isShort = width !== null && height !== null && height >= width && (probe.durationMs ?? Infinity) <= 180_000;
    return isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://youtu.be/${videoId}`;
  }
}
