import type { MediaRules, ProbeResult, ValidationIssue } from '../../media-processing/rules';
import { MetaGraphClient } from '../meta/meta-graph.client';
import { instagramOptionsSchema, textIssues } from '../option-schemas';
import {
  ClassifiedError,
  classifyUnknownError,
  ProviderError,
  PublishContext,
  ReconcileResult,
  SocialPublisher,
  StepResult,
} from '../types';

interface IgCheckpoint {
  containerId?: string | null;
  mediaId?: string | null;
}

type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

/**
 * Instagram Reels via the Graph API content publishing flow (§21):
 * CHECK_LIMIT → CREATE_CONTAINER → WAIT_CONTAINER → PUBLISH_CONTAINER → FETCH_PERMALINK. (verify against current docs)
 */
export class InstagramPublisher implements SocialPublisher {
  readonly platformCode = 'instagram';
  readonly initialStep = 'CHECK_LIMIT';
  readonly nonIdempotentSteps = new Set(['PUBLISH_CONTAINER']);
  readonly optionsSchema = instagramOptionsSchema;

  validate(_probe: ProbeResult, text: { title?: string; caption?: string }, _rules: MediaRules): ValidationIssue[] {
    return textIssues(this.platformCode, text);
  }

  async runStep(step: string, ctx: PublishContext): Promise<StepResult> {
    const graph = new MetaGraphClient(ctx.config.apiVersion, 'Instagram');
    const token = await this.token(ctx);
    const igUserId = ctx.account.externalAccountId;
    const cp = ctx.checkpoint as IgCheckpoint;

    switch (step) {
      case 'CHECK_LIMIT': {
        const limit = await graph.get<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }> }>(
          `${igUserId}/content_publishing_limit`,
          { fields: 'quota_usage,config' },
          token,
          ctx.signal,
        );
        const entry = limit.data?.[0];
        if (entry?.config?.quota_total !== undefined && (entry.quota_usage ?? 0) >= entry.config.quota_total) {
          throw new ProviderError({
            category: 'PROVIDER_LIMIT',
            code: 'IG_PUBLISH_LIMIT',
            userMessage: `Instagram publishing limit reached (${entry.config.quota_total} per day). Will retry later.`,
            retryAfterMs: 3_600_000,
            requestHadNoEffect: true,
          });
        }
        return { kind: 'advance', nextStep: cp.containerId ? 'WAIT_CONTAINER' : 'CREATE_CONTAINER' };
      }
      case 'CREATE_CONTAINER': {
        const options = this.optionsSchema.parse(ctx.options);
        const videoUrl = await ctx.media.signedUrl(6 * 3600);
        const created = await graph.post<{ id: string }>(
          `${igUserId}/media`,
          {
            media_type: 'REELS',
            video_url: videoUrl,
            caption: ctx.text.caption ?? '',
            share_to_feed: options.shareToFeed,
            thumb_offset: options.coverFrameMs || undefined,
          },
          token,
          { signal: ctx.signal },
        );
        return { kind: 'advance', nextStep: 'WAIT_CONTAINER', checkpoint: { containerId: created.id, mediaId: null } };
      }
      case 'WAIT_CONTAINER': {
        if (!cp.containerId) return { kind: 'advance', nextStep: 'CREATE_CONTAINER' };
        const status = await this.containerStatus(graph, cp.containerId, token, ctx.signal);
        switch (status.code) {
          case 'FINISHED':
            return { kind: 'advance', nextStep: 'PUBLISH_CONTAINER' };
          case 'IN_PROGRESS':
            return { kind: 'wait', step: 'WAIT_CONTAINER', pollAfterMs: 60_000 };
          case 'EXPIRED':
            return { kind: 'advance', nextStep: 'CREATE_CONTAINER', checkpoint: { containerId: null } };
          case 'ERROR':
            throw new ProviderError({
              category: 'MEDIA_INVALID',
              code: 'IG_CONTAINER_ERROR',
              providerCode: status.detail ?? 'ERROR',
              userMessage: `Instagram couldn't process this video${status.detail ? `: ${status.detail}` : '.'}`,
              requestHadNoEffect: true,
            });
          case 'PUBLISHED':
            throw new ProviderError({ category: 'UNKNOWN_OUTCOME', code: 'IG_CONTAINER_ALREADY_PUBLISHED', userMessage: 'Checking whether Instagram already published this.', requestHadNoEffect: false });
        }
        return { kind: 'wait', step: 'WAIT_CONTAINER', pollAfterMs: 60_000 };
      }
      case 'PUBLISH_CONTAINER': {
        const published = await graph.post<{ id: string }>(`${igUserId}/media_publish`, { creation_id: cp.containerId! }, token, {
          signal: ctx.signal,
          nonIdempotent: true,
        });
        return { kind: 'advance', nextStep: 'FETCH_PERMALINK', checkpoint: { mediaId: published.id } };
      }
      case 'FETCH_PERMALINK': {
        const media = await graph.get<{ id: string; permalink?: string }>(cp.mediaId!, { fields: 'id,permalink,shortcode' }, token, ctx.signal);
        return { kind: 'done', externalId: media.id, externalUrl: media.permalink };
      }
      default:
        throw new Error(`Unknown Instagram step ${step}`);
    }
  }

  async reconcile(ctx: PublishContext): Promise<ReconcileResult> {
    const graph = new MetaGraphClient(ctx.config.apiVersion, 'Instagram');
    const token = await this.token(ctx);
    const cp = ctx.checkpoint as IgCheckpoint;

    if (cp.mediaId) return { kind: 'in_progress', step: 'FETCH_PERMALINK' };
    if (!cp.containerId) return { kind: 'not_published', resumeFromStep: 'CHECK_LIMIT' };

    const status = await this.containerStatus(graph, cp.containerId, token, ctx.signal);
    switch (status.code) {
      case 'PUBLISHED': {
        const since = (ctx.publication.inFlightStartedAt?.getTime() ?? Date.now() - 3_600_000) - 2 * 60_000;
        const recent = await graph.get<{ data?: Array<{ id: string; caption?: string; timestamp?: string; permalink?: string }> }>(
          `${ctx.account.externalAccountId}/media`,
          { fields: 'id,caption,timestamp,permalink', limit: '10' },
          token,
          ctx.signal,
        );
        const matches = (recent.data ?? []).filter(
          (m) => (m.caption ?? '') === (ctx.text.caption ?? '') && (!m.timestamp || Date.parse(m.timestamp) >= since),
        );
        if (matches.length === 1) return { kind: 'published', externalId: matches[0].id, externalUrl: matches[0].permalink, checkpoint: { mediaId: matches[0].id } };
        return { kind: 'undeterminable', hint: `Found ${matches.length} matching Instagram posts` };
      }
      case 'FINISHED':
        return { kind: 'not_published', resumeFromStep: 'PUBLISH_CONTAINER' };
      case 'IN_PROGRESS':
        return { kind: 'in_progress', step: 'WAIT_CONTAINER' };
      default:
        return { kind: 'not_published', resumeFromStep: 'CREATE_CONTAINER', checkpoint: { containerId: null } };
    }
  }

  classifyError(error: unknown, _step: string, meta: { nonIdempotent: boolean }): ClassifiedError {
    return classifyUnknownError(error, meta.nonIdempotent);
  }

  stepTimeoutMs(): number {
    return 90_000;
  }

  maxWaitMs(): number {
    return 30 * 60_000;
  }

  private async token(ctx: PublishContext): Promise<string> {
    const credentials = await ctx.credentials();
    return credentials.destinationToken ?? credentials.accessToken;
  }

  private async containerStatus(graph: MetaGraphClient, containerId: string, token: string, signal: AbortSignal): Promise<{ code: ContainerStatus; detail?: string }> {
    const result = await graph.get<{ status_code?: ContainerStatus; status?: string }>(containerId, { fields: 'status_code,status' }, token, signal);
    return { code: result.status_code ?? 'IN_PROGRESS', detail: result.status };
  }
}
