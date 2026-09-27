import type { z } from 'zod';
import type { MediaRules, ProbeResult, ValidationIssue } from '../../media-processing/rules';
import { textIssues } from '../option-schemas';
import {
  ClassifiedError,
  classifyUnknownError,
  ProviderError,
  PublishContext,
  ReconcileResult,
  SocialPublisher,
  StepResult,
} from '../types';

type Scenario = {
  waitPolls?: number;
  failAt?: string;
  failWith?: ClassifiedError['category'];
  failTimes?: number;
  crashAfterSendAt?: string;
};

/**
 * Simulated provider state. It lives outside the publication checkpoint on purpose:
 * a "crash after send" must leave the provider with a post the checkpoint knows nothing about,
 * exactly like a real provider would, so reconciliation is exercised for real.
 */
export class FakeProviderState {
  private static posts = new Map<string, { externalId: string; url: string }>();
  private static failures = new Map<string, number>();

  static publish(publicationId: string, platform: string, apiBaseUrl: string) {
    const existing = this.posts.get(publicationId);
    if (existing) return existing;
    const externalId = `fake_${platform}_${publicationId.slice(0, 8)}_${Date.now().toString(36)}`;
    const post = { externalId, url: `${apiBaseUrl}/dev/fake-posts/${platform}/${externalId}` };
    this.posts.set(publicationId, post);
    return post;
  }

  static find(publicationId: string) {
    return this.posts.get(publicationId);
  }

  static forget(publicationId: string) {
    this.posts.delete(publicationId);
  }

  /** Returns true while the scenario still wants this step to fail. */
  static shouldFail(publicationId: string, step: string, times: number): boolean {
    const key = `${publicationId}:${step}`;
    const count = this.failures.get(key) ?? 0;
    if (count >= times) return false;
    this.failures.set(key, count + 1);
    return true;
  }

  static reset() {
    this.posts.clear();
    this.failures.clear();
  }
}

class SimulatedCrashAfterSend extends Error {
  constructor() {
    super('Simulated connection reset after the publish request was sent');
    this.name = 'TimeoutError';
  }
}

const STEPS = ['UPLOAD', 'PROCESSING', 'PUBLISH'] as const;

const FAILURE_MESSAGES: Record<string, string> = {
  TRANSIENT: 'The platform had a temporary problem. Will retry.',
  RATE_LIMITED: 'The platform is rate limiting requests. Will retry later.',
  AUTH: 'The connection expired. Reconnect the account to continue.',
  MEDIA_INVALID: "The platform couldn't process this video.",
  VALIDATION: 'The platform rejected the request.',
  PERMISSION: "The account doesn't allow publishing.",
};

/**
 * Stands in for a real platform adapter in PROVIDER_MODE=fake: same options, validation and
 * checkpoint/reconcile semantics, but no network calls to Google or Meta.
 */
export class FakePublisher implements SocialPublisher {
  readonly initialStep = 'UPLOAD';
  readonly nonIdempotentSteps = new Set(['PUBLISH']);

  constructor(
    readonly platformCode: string,
    readonly optionsSchema: z.ZodType<Record<string, unknown>>,
    private readonly pollMs = 2000,
  ) {}

  validate(_probe: ProbeResult, text: { title?: string; caption?: string }, _rules: MediaRules): ValidationIssue[] {
    return textIssues(this.platformCode, text);
  }

  async runStep(step: string, ctx: PublishContext): Promise<StepResult> {
    const scenario = (ctx.options.fake ?? {}) as Scenario;
    if (scenario.failAt === step && scenario.failWith && FakeProviderState.shouldFail(ctx.publication.id, step, scenario.failTimes ?? 1)) {
      throw new ProviderError({
        category: scenario.failWith,
        code: `FAKE_${scenario.failWith}`,
        userMessage: FAILURE_MESSAGES[scenario.failWith] ?? 'Simulated failure',
        retryAfterMs: scenario.failWith === 'RATE_LIMITED' ? 5_000 : undefined,
        requestHadNoEffect: true,
      });
    }

    switch (step) {
      case 'UPLOAD': {
        // Prove the stored video is actually readable, like a real upload would.
        const stream = await ctx.media.openRange(0, Math.min(1023, Math.max(ctx.media.sizeBytes - 1, 0)));
        let bytes = 0;
        for await (const chunk of stream) bytes += (chunk as Buffer).length;
        if (bytes === 0) throw new ProviderError({ category: 'MEDIA_INVALID', code: 'FAKE_EMPTY_MEDIA', userMessage: 'The video file is empty.', requestHadNoEffect: true });
        return { kind: 'advance', nextStep: 'PROCESSING', checkpoint: { uploadedBytes: ctx.media.sizeBytes, uploadId: `upl_${ctx.publication.id.slice(0, 8)}` } };
      }
      case 'PROCESSING': {
        const polls = scenario.waitPolls ?? 2;
        if (ctx.publication.pollCount < polls) return { kind: 'wait', step: 'PROCESSING', pollAfterMs: this.pollMs };
        return { kind: 'advance', nextStep: 'PUBLISH' };
      }
      case 'PUBLISH': {
        const post = FakeProviderState.publish(ctx.publication.id, this.platformCode, ctx.config.apiBaseUrl);
        if (scenario.crashAfterSendAt === 'PUBLISH' && FakeProviderState.shouldFail(ctx.publication.id, 'CRASH_PUBLISH', 1)) {
          throw new SimulatedCrashAfterSend();
        }
        return { kind: 'done', externalId: post.externalId, externalUrl: post.url, checkpoint: { externalId: post.externalId } };
      }
      default:
        throw new Error(`Unknown fake step ${step}`);
    }
  }

  async reconcile(ctx: PublishContext): Promise<ReconcileResult> {
    const post = FakeProviderState.find(ctx.publication.id);
    if (post) return { kind: 'published', externalId: post.externalId, externalUrl: post.url };
    const stepIndex = ctx.checkpoint.uploadId ? STEPS.indexOf('PROCESSING') : 0;
    return { kind: 'not_published', resumeFromStep: STEPS[stepIndex] };
  }

  classifyError(error: unknown, _step: string, meta: { nonIdempotent: boolean }): ClassifiedError {
    return classifyUnknownError(error, meta.nonIdempotent);
  }

  stepTimeoutMs(): number {
    return 30_000;
  }

  maxWaitMs(): number {
    return 10 * 60_000;
  }
}
