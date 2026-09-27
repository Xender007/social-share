import type { MediaRules, ProbeResult, ValidationIssue } from '../../media-processing/rules';
import { httpJson } from '../http';
import { metaError, MetaErrorBody, MetaGraphClient } from '../meta/meta-graph.client';
import { facebookOptionsSchema, textIssues } from '../option-schemas';
import {
  ClassifiedError,
  classifyUnknownError,
  ProviderError,
  PublishContext,
  ReconcileResult,
  SocialPublisher,
  StepResult,
} from '../types';

interface FbCheckpoint {
  videoId?: string | null;
  uploadUrl?: string | null;
  finishSent?: boolean;
}

interface PhaseStatus {
  status?: 'not_started' | 'in_progress' | 'complete' | 'error';
  errors?: Array<{ code?: number; message?: string }>;
}

interface FbVideoStatus {
  status?: {
    video_status?: string;
    uploading_phase?: PhaseStatus;
    processing_phase?: PhaseStatus;
    publishing_phase?: PhaseStatus & { publish_status?: string };
  };
  permalink_url?: string;
  published?: boolean;
}

/**
 * Facebook Page Reels with a hosted file (§22):
 * START_UPLOAD → TRANSFER → WAIT_UPLOAD → FINISH → WAIT_PUBLISH. (verify against current video_reels docs)
 */
export class FacebookPublisher implements SocialPublisher {
  readonly platformCode = 'facebook';
  readonly initialStep = 'START_UPLOAD';
  readonly nonIdempotentSteps = new Set(['FINISH']);
  readonly optionsSchema = facebookOptionsSchema;

  validate(_probe: ProbeResult, text: { title?: string; caption?: string }, _rules: MediaRules): ValidationIssue[] {
    return textIssues(this.platformCode, text);
  }

  async runStep(step: string, ctx: PublishContext): Promise<StepResult> {
    const graph = new MetaGraphClient(ctx.config.apiVersion, 'Facebook');
    const token = await this.pageToken(ctx);
    const pageId = ctx.account.externalAccountId;
    const cp = ctx.checkpoint as FbCheckpoint;

    switch (step) {
      case 'START_UPLOAD': {
        const started = await graph.post<{ video_id: string; upload_url: string }>(`${pageId}/video_reels`, { upload_phase: 'start' }, token, { signal: ctx.signal });
        return { kind: 'advance', nextStep: 'TRANSFER', checkpoint: { videoId: started.video_id, uploadUrl: started.upload_url, finishSent: false } };
      }
      case 'TRANSFER': {
        if (!cp.uploadUrl) return { kind: 'advance', nextStep: 'START_UPLOAD' };
        const fileUrl = await ctx.media.signedUrl(6 * 3600);
        const res = await httpJson<{ success?: boolean } & MetaErrorBody>(cp.uploadUrl, {
          method: 'POST',
          headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
          signal: ctx.signal,
        });
        if (res.status !== 200 || res.body?.error) throw metaError(res, 'Facebook', { nonIdempotent: false });
        return { kind: 'advance', nextStep: 'WAIT_UPLOAD' };
      }
      case 'WAIT_UPLOAD': {
        const video = await this.status(graph, cp.videoId!, token, ctx.signal);
        const phase = video.status?.uploading_phase;
        if (phase?.status === 'complete') return { kind: 'advance', nextStep: 'FINISH' };
        if (phase?.status === 'error') throw this.phaseError('upload', phase);
        return { kind: 'wait', step: 'WAIT_UPLOAD', pollAfterMs: 10_000 };
      }
      case 'FINISH': {
        await graph.post<{ success?: boolean }>(
          `${pageId}/video_reels`,
          { upload_phase: 'finish', video_id: cp.videoId!, video_state: 'PUBLISHED', description: ctx.text.caption ?? '' },
          token,
          { signal: ctx.signal, nonIdempotent: true },
        );
        return { kind: 'advance', nextStep: 'WAIT_PUBLISH', checkpoint: { finishSent: true } };
      }
      case 'WAIT_PUBLISH': {
        const video = await this.status(graph, cp.videoId!, token, ctx.signal);
        const processing = video.status?.processing_phase;
        const publishing = video.status?.publishing_phase;
        if (processing?.status === 'error') throw this.phaseError('processing', processing);
        if (publishing?.status === 'error') throw this.phaseError('publishing', publishing);
        if (publishing?.status === 'complete' || video.status?.video_status === 'ready' || video.published) {
          return { kind: 'done', externalId: cp.videoId!, externalUrl: this.permalink(video, cp.videoId!) };
        }
        return { kind: 'wait', step: 'WAIT_PUBLISH', pollAfterMs: 15_000 };
      }
      default:
        throw new Error(`Unknown Facebook step ${step}`);
    }
  }

  async reconcile(ctx: PublishContext): Promise<ReconcileResult> {
    const cp = ctx.checkpoint as FbCheckpoint;
    if (!cp.videoId) return { kind: 'not_published', resumeFromStep: 'START_UPLOAD' };
    const graph = new MetaGraphClient(ctx.config.apiVersion, 'Facebook');
    const video = await this.status(graph, cp.videoId, await this.pageToken(ctx), ctx.signal);
    const publishing = video.status?.publishing_phase?.status;
    if (publishing === 'complete' || video.published) return { kind: 'published', externalId: cp.videoId, externalUrl: this.permalink(video, cp.videoId) };
    if (publishing === 'in_progress' || video.status?.processing_phase?.status === 'in_progress') return { kind: 'in_progress', step: 'WAIT_PUBLISH' };
    if (video.status?.uploading_phase?.status === 'complete') return { kind: 'not_published', resumeFromStep: 'FINISH' };
    return { kind: 'not_published', resumeFromStep: 'TRANSFER' };
  }

  classifyError(error: unknown, _step: string, meta: { nonIdempotent: boolean }): ClassifiedError {
    return classifyUnknownError(error, meta.nonIdempotent);
  }

  stepTimeoutMs(step: string): number {
    return step === 'TRANSFER' ? 10 * 60_000 : 90_000;
  }

  maxWaitMs(): number {
    return 60 * 60_000;
  }

  private async pageToken(ctx: PublishContext): Promise<string> {
    const credentials = await ctx.credentials();
    if (!credentials.destinationToken) {
      throw new ProviderError({ category: 'AUTH', code: 'FB_PAGE_TOKEN_MISSING', userMessage: 'Reconnect Facebook to refresh Page access.', requestHadNoEffect: true });
    }
    return credentials.destinationToken;
  }

  private status(graph: MetaGraphClient, videoId: string, token: string, signal: AbortSignal): Promise<FbVideoStatus> {
    return graph.get<FbVideoStatus>(videoId, { fields: 'status,permalink_url,published' }, token, signal);
  }

  private phaseError(phase: string, status: PhaseStatus): ProviderError {
    const detail = status.errors?.[0]?.message;
    return new ProviderError({
      category: 'MEDIA_INVALID',
      code: `FB_${phase.toUpperCase()}_ERROR`,
      providerCode: String(status.errors?.[0]?.code ?? phase),
      userMessage: `Facebook ${phase} failed${detail ? `: ${detail}` : '.'}`,
      requestHadNoEffect: true,
    });
  }

  private permalink(video: FbVideoStatus, videoId: string): string {
    if (video.permalink_url) return video.permalink_url.startsWith('http') ? video.permalink_url : `https://www.facebook.com${video.permalink_url}`;
    return `https://www.facebook.com/reel/${videoId}`;
  }
}
