import { Injectable, Logger } from '@nestjs/common';
import { addMs } from '../common/time';
import { JobQueueService, QUEUES } from '../jobs/job-queue.service';
import { KillSwitchService } from '../kill-switches/kill-switch.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ClassifiedError, SocialPublisher, StepResult } from '../publishers/types';
import { SettingsService } from '../settings/settings.service';
import { AdapterRegistry } from './adapter-registry';
import { pollDelayMs, retryDelayMs } from './backoff';
import { PublishContextFactory } from './publish-context.factory';
import { ConcurrentModificationError, PublicationRepository, PublicationRow, RunnerCheckpoint, TransitionEvents } from './publication.repository';
import { PublishingEvents } from './publishing-events.service';
import { outcomeForError } from './state-machine';

const MAX_STEPS_PER_JOB = 20;
const STALE_IN_PROGRESS_MS = 10 * 60_000;
const MAX_RECONCILE_ATTEMPTS = 3;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Step timed out after ${ms}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Executes publications step by step with checkpoints (§18.3).
 * Every provider ID is saved before the next step; non-idempotent steps are marked in flight so a crash
 * or timeout leads to reconciliation instead of a duplicate post.
 */
@Injectable()
export class PublicationRunner {
  private readonly logger = new Logger(PublicationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PublicationRepository,
    private readonly registry: AdapterRegistry,
    private readonly contexts: PublishContextFactory,
    private readonly killSwitches: KillSwitchService,
    private readonly settings: SettingsService,
    private readonly jobs: JobQueueService,
    private readonly events: PublishingEvents,
  ) {}

  async run(publicationId: string, jobId?: string): Promise<void> {
    try {
      await this.runInner(publicationId, jobId);
    } catch (error) {
      if (error instanceof ConcurrentModificationError) {
        this.logger.warn(`Publication ${publicationId} changed during run; another worker or user action won.`);
        return;
      }
      throw error;
    }
  }

  private async runInner(publicationId: string, jobId?: string): Promise<void> {
    let pub = await this.repo.load(publicationId);
    if (!pub) return;
    const now = Date.now();

    switch (pub.status) {
      case 'QUEUED':
        break;
      case 'RETRY_SCHEDULED':
      case 'WAITING_PROVIDER':
        if (pub.nextAttemptAt && pub.nextAttemptAt.getTime() > now + 1000) return;
        break;
      case 'IN_PROGRESS':
        if (now - pub.updatedAt.getTime() < STALE_IN_PROGRESS_MS) return; // another worker is active
        break;
      default:
        return;
    }

    if (await this.killSwitches.blocks(pub.platform.code, 'publish')) {
      await this.apply(pub, 'PAUSED', { errorCode: 'KILL_SWITCH', errorMessage: `Publishing to ${pub.platform.name} is paused.` });
      return;
    }

    const adapter = this.registry.publisher(pub.platform.code);
    const checkpoint = this.repo.checkpointOf(pub);

    if (checkpoint.inFlight) {
      this.logger.warn(`Publication ${pub.id} has an in-flight ${checkpoint.inFlight.step}; reconciling instead of re-running.`);
      if (pub.status !== 'QUEUED' && pub.status !== 'IN_PROGRESS') {
        pub = (await this.apply(pub, 'QUEUED', {}))!;
      }
      await this.apply(pub, 'UNKNOWN_OUTCOME', { errorCategory: 'UNKNOWN_OUTCOME', errorCode: 'CRASH_DURING_STEP' });
      await this.jobs.send(QUEUES.publicationReconcile, { publicationId: pub.id }, { singletonKey: `reconcile:${pub.id}` });
      return;
    }

    pub = (await this.apply(pub, 'IN_PROGRESS', { startedAt: pub.startedAt ?? new Date(), nextAttemptAt: null, lastCheckedAt: new Date() }))!;
    let step = pub.currentStep ?? adapter.initialStep;

    for (let i = 0; i < MAX_STEPS_PER_JOB; i++) {
      const timeoutMs = adapter.stepTimeoutMs(step);
      const ctx = await this.contexts.build(pub, adapter, timeoutMs);
      const nonIdempotent = adapter.nonIdempotentSteps.has(step);
      const attempt = await this.prisma.publicationAttempt.create({
        data: { publicationId: pub.id, attemptNumber: pub.attemptCount + 1, jobId: jobId ?? null, step },
      });

      if (nonIdempotent) {
        pub = await this.repo.saveCheckpoint(pub, { inFlight: { step, startedAt: new Date().toISOString() } }, { currentStep: step });
      }

      let result: StepResult;
      try {
        result = await withTimeout(adapter.runStep(step, ctx), timeoutMs);
      } catch (error) {
        const classified = adapter.classifyError(error, step, { nonIdempotent });
        await this.prisma.publicationAttempt.update({
          where: { id: attempt.id },
          data: {
            outcome: 'FAILED',
            finishedAt: new Date(),
            errorCategory: classified.category,
            httpStatus: classified.httpStatus ?? null,
            providerErrorCode: classified.providerCode ?? null,
            errorMessage: classified.userMessage,
          },
        });
        await this.handleFailure(await this.reload(pub), adapter, step, classified, nonIdempotent);
        return;
      }

      // Persist provider IDs before anything else.
      const changes: RunnerCheckpoint = { inFlight: null };
      if (result.checkpoint) changes[adapter.platformCode] = result.checkpoint;
      pub = await this.repo.saveCheckpoint(pub, changes);
      await this.prisma.publicationAttempt.update({
        where: { id: attempt.id },
        data: { outcome: result.kind === 'done' ? 'SUCCEEDED' : result.kind === 'wait' ? 'WAITING' : 'ADVANCED', finishedAt: new Date() },
      });

      if (result.kind === 'done') {
        await this.apply(pub, 'PUBLISHED', {
          externalId: result.externalId,
          externalUrl: result.externalUrl ?? null,
          publishedAt: new Date(),
          currentStep: null,
          nextAttemptAt: null,
          waitingSince: null,
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
          providerErrorCode: null,
        });
        this.logger.log(`Publication ${pub.id} published to ${pub.platform.code}: ${result.externalId}`);
        return;
      }

      if (result.kind === 'wait') {
        const waitingSince = pub.waitingSince ?? new Date();
        if (Date.now() - waitingSince.getTime() > adapter.maxWaitMs(result.step)) {
          await this.apply(pub, 'NEEDS_USER_ACTION', {
            errorCategory: 'MEDIA_INVALID',
            errorCode: 'PROVIDER_PROCESSING_TIMEOUT',
            errorMessage: `${pub.platform.name} is taking too long to process this video.`,
          });
          return;
        }
        const pollCount = (this.repo.checkpointOf(pub).pollCount ?? 0) + 1;
        const delay = result.pollAfterMs ?? pollDelayMs(pollCount - 1);
        const nextAttemptAt = addMs(new Date(), delay);
        pub = await this.repo.saveCheckpoint(pub, { pollCount });
        await this.apply(pub, 'WAITING_PROVIDER', { currentStep: result.step, nextAttemptAt, waitingSince });
        await this.enqueueRun(pub.platform.code, pub.id, nextAttemptAt);
        return;
      }

      step = result.nextStep;
      pub = await this.repo.saveCheckpoint(pub, { pollCount: 0 }, { currentStep: step, waitingSince: null });
    }

    await this.apply(pub, 'RETRY_SCHEDULED', { errorCode: 'STEP_LIMIT', nextAttemptAt: addMs(new Date(), 60_000) });
    await this.enqueueRun(pub.platform.code, pub.id, addMs(new Date(), 60_000));
  }

  private async handleFailure(pub: PublicationRow, adapter: SocialPublisher, step: string, error: ClassifiedError, nonIdempotent: boolean): Promise<void> {
    // A non-idempotent call that may have reached the provider is never blindly retried.
    const category = nonIdempotent && !error.requestHadNoEffect ? 'UNKNOWN_OUTCOME' : error.category;
    const maxAttempts = await this.settings.get('publish_max_attempts');
    const outcome = outcomeForError(category, pub.attemptCount, maxAttempts, { retryAfterMs: error.retryAfterMs });
    this.logger.warn(`Publication ${pub.id} failed at ${step}: ${error.code} (${category}) -> ${outcome.status}`);

    const base = {
      errorCategory: category,
      errorCode: error.code,
      providerErrorCode: error.providerCode ?? null,
      errorMessage: error.userMessage,
      attemptCount: outcome.consumesAttempt ? pub.attemptCount + 1 : pub.attemptCount,
      currentStep: step,
    };

    if (category !== 'UNKNOWN_OUTCOME' && this.repo.checkpointOf(pub).inFlight) {
      pub = await this.repo.saveCheckpoint(pub, { inFlight: null });
    }

    if (category === 'MEDIA_INVALID' && !pub.mediaVariantId && (await this.settings.get('transcode_policy')) !== 'never') {
      await this.apply(pub, 'PENDING_MEDIA', { ...base, currentStep: adapter.initialStep });
      await this.jobs.send(QUEUES.mediaTranscode, { mediaId: pub.post.mediaId, reason: 'provider_rejected', publicationId: pub.id }, { singletonKey: `transcode:${pub.post.mediaId}` });
      return;
    }

    switch (outcome.status) {
      case 'RETRY_SCHEDULED': {
        const delay = error.retryAfterMs ?? retryDelayMs(base.attemptCount || 1);
        const nextAttemptAt = addMs(new Date(), delay);
        await this.apply(pub, 'RETRY_SCHEDULED', { ...base, nextAttemptAt });
        await this.enqueueRun(pub.platform.code, pub.id, nextAttemptAt);
        if (outcome.notify) await this.events.publicationDelayed(pub, nextAttemptAt);
        return;
      }
      case 'UNKNOWN_OUTCOME':
        await this.apply(pub, 'UNKNOWN_OUTCOME', base);
        await this.jobs.send(QUEUES.publicationReconcile, { publicationId: pub.id }, { singletonKey: `reconcile:${pub.id}`, startAfter: 5 });
        return;
      case 'NEEDS_USER_ACTION':
        if (category === 'AUTH') {
          await this.prisma.socialAccount.update({ where: { id: pub.socialAccountId }, data: { status: 'REAUTH_REQUIRED', statusReason: error.userMessage } });
          await this.prisma.providerConnection.update({ where: { id: pub.socialAccount.connectionId }, data: { status: 'REAUTH_REQUIRED', lastError: error.code } });
        }
        await this.apply(pub, 'NEEDS_USER_ACTION', base);
        return;
      default:
        await this.apply(pub, outcome.status, { ...base, nextAttemptAt: null });
    }
  }

  /** Resolves UNKNOWN_OUTCOME by asking the provider what actually happened (§18.5). */
  async reconcile(publicationId: string): Promise<void> {
    let pub = await this.repo.load(publicationId);
    if (!pub || pub.status !== 'UNKNOWN_OUTCOME') return;
    const adapter = this.registry.publisher(pub.platform.code);
    const checkpoint = this.repo.checkpointOf(pub);

    try {
      const ctx = await this.contexts.build(pub, adapter, 60_000);
      const result = await withTimeout(adapter.reconcile(ctx), 60_000);
      const nsChanges: RunnerCheckpoint = { inFlight: null, pollCount: 0, reconcileAttempts: 0 };
      if ('checkpoint' in result && result.checkpoint) nsChanges[adapter.platformCode] = result.checkpoint;

      switch (result.kind) {
        case 'published':
          pub = await this.repo.saveCheckpoint(pub, nsChanges);
          await this.apply(pub, 'PUBLISHED', {
            externalId: result.externalId,
            externalUrl: result.externalUrl ?? null,
            publishedAt: new Date(),
            currentStep: null,
            errorCategory: null,
            errorCode: null,
            errorMessage: null,
          });
          this.logger.log(`Reconcile: publication ${pub.id} was already published (${result.externalId}); no duplicate created.`);
          return;
        case 'in_progress': {
          pub = await this.repo.saveCheckpoint(pub, nsChanges);
          const nextAttemptAt = addMs(new Date(), 10_000);
          await this.apply(pub, 'WAITING_PROVIDER', { currentStep: result.step, nextAttemptAt, waitingSince: new Date() });
          await this.enqueueRun(pub.platform.code, pub.id, nextAttemptAt);
          return;
        }
        case 'not_published':
          pub = await this.repo.saveCheckpoint(pub, nsChanges);
          await this.apply(pub, 'QUEUED', { currentStep: result.resumeFromStep, errorCategory: null, errorCode: null, errorMessage: null });
          await this.enqueueRun(pub.platform.code, pub.id);
          return;
        case 'undeterminable':
          pub = await this.repo.saveCheckpoint(pub, { hadUnknownOutcome: true });
          await this.apply(pub, 'NEEDS_USER_ACTION', {
            errorCategory: 'UNKNOWN_OUTCOME',
            errorCode: 'OUTCOME_UNCONFIRMED',
            errorMessage: `We couldn't confirm whether this posted to ${pub.platform.name}. Check your profile.`,
          });
          return;
      }
    } catch (error) {
      const attempts = (checkpoint.reconcileAttempts ?? 0) + 1;
      this.logger.warn(`Reconcile attempt ${attempts} for ${publicationId} failed: ${(error as Error).message}`);
      pub = await this.repo.saveCheckpoint(pub, { reconcileAttempts: attempts });
      if (attempts >= MAX_RECONCILE_ATTEMPTS) {
        pub = await this.repo.saveCheckpoint(pub, { hadUnknownOutcome: true });
        await this.apply(pub, 'NEEDS_USER_ACTION', {
          errorCategory: 'UNKNOWN_OUTCOME',
          errorCode: 'OUTCOME_UNCONFIRMED',
          errorMessage: `We couldn't confirm whether this posted to ${pub.platform.name}. Check your profile.`,
        });
        return;
      }
      await this.jobs.send(QUEUES.publicationReconcile, { publicationId }, { startAfter: 30 * attempts });
    }
  }

  enqueueRun(platformCode: string, publicationId: string, startAfter?: Date): Promise<string | null> {
    return this.jobs.send(QUEUES.publicationRun(platformCode), { publicationId }, { startAfter, singletonKey: `run:${publicationId}` });
  }

  private async apply(pub: PublicationRow, to: Parameters<PublicationRepository['transition']>[1], patch: Parameters<PublicationRepository['transition']>[2]): Promise<PublicationRow | undefined> {
    const { pub: updated, events } = await this.repo.transition(pub, to, patch);
    await this.dispatch(updated, events);
    return updated;
  }

  private async dispatch(pub: PublicationRow, events: TransitionEvents): Promise<void> {
    if (events.needsAction) await this.events.publicationNeedsAction(pub);
    if (events.postBecameTerminal) await this.events.postCompleted(events.postBecameTerminal.postId);
  }

  private reload(pub: PublicationRow): Promise<PublicationRow> {
    return this.prisma.publication.findUniqueOrThrow({ where: { id: pub.id }, include: { post: true, platform: true, mediaVariant: true, socialAccount: { include: { connection: true } } } });
  }
}
