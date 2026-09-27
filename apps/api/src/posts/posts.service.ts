import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { CreatePostRequest, PostListResponse, PostView, ResolvePublicationRequest } from '@sp/contracts';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { actionNotAllowed, AppError, notFound } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { toJsonValue } from '../common/time';
import { AppConfig } from '../config/app-config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { Prisma } from '../generated/prisma/client';
import { MediaProcessingService } from '../media-processing/media-processing.service';
import { decideMediaUse, MediaRules, ProbeResult, ValidationIssue, validateMedia } from '../media-processing/rules';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../publishing/adapter-registry';
import { PublicationRunner } from '../publishing/publication-runner.service';
import { PublicationRepository, publicationInclude, RunnerCheckpoint } from '../publishing/publication.repository';
import { PublishingEvents } from '../publishing/publishing-events.service';
import { SettingsService } from '../settings/settings.service';
import { postViewInclude, toPostView } from './post-view';

interface PublishConfig {
  limits: { titleRequired: boolean; titleMaxChars?: number; captionMaxChars: number };
  mediaRules: MediaRules;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly registry: AdapterRegistry,
    private readonly settings: SettingsService,
    private readonly runner: PublicationRunner,
    private readonly repo: PublicationRepository,
    private readonly events: PublishingEvents,
    private readonly mediaProcessing: MediaProcessingService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async create(userId: string, idempotencyKey: string | undefined, body: CreatePostRequest, meta: RequestMeta): Promise<{ created: boolean; post: PostView }> {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.', HttpStatus.BAD_REQUEST);
    }
    const requestHash = createHash('sha256').update(canonicalJson(body)).digest('hex');
    const existing = await this.prisma.post.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: postViewInclude });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different post.', HttpStatus.CONFLICT);
      }
      return { created: false, post: toPostView(existing) };
    }

    const media = await this.prisma.media.findFirst({ where: { id: body.mediaId, userId } });
    if (!media) throw notFound('Video');
    if (media.status === 'INVALID' || media.status === 'DELETED') {
      throw new AppError('MEDIA_INVALID', "This video can't be used. Please upload it again.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (media.status === 'PENDING_UPLOAD') throw new AppError('MEDIA_NOT_READY', 'The video is still uploading.', HttpStatus.CONFLICT);

    const ids = body.destinations.map((d) => d.socialAccountId);
    if (new Set(ids).size !== ids.length) throw actionNotAllowed('Each account can only be selected once.');

    const snapshot = await this.entitlements.snapshot(userId);
    const accounts = await this.prisma.socialAccount.findMany({ where: { id: { in: ids }, userId }, include: { platform: true } });
    const probe = media.status === 'READY' ? (media.probe as unknown as ProbeResult) : null;
    const policy = await this.settings.get('transcode_policy');

    const incompatible: Array<{ socialAccountId: string; platform: string; issues: ValidationIssue[] }> = [];
    const plans: Array<Prisma.PublicationCreateManyPostInput & { platformCode: string }> = [];

    for (const [index, dest] of body.destinations.entries()) {
      const account = accounts.find((a) => a.id === dest.socialAccountId);
      if (!account || account.status !== 'ACTIVE') {
        throw new AppError('DESTINATION_UNAVAILABLE', `${account?.platform.name ?? 'This account'} isn't available. Reconnect it and try again.`, HttpStatus.UNPROCESSABLE_ENTITY, {
          socialAccountId: dest.socialAccountId,
          status: account?.status ?? 'NOT_FOUND',
        });
      }
      const platform = account.platform;
      await this.entitlements.assert(userId, `${platform.code}.publish`, snapshot);
      const adapter = this.registry.publisher(platform.code);

      const parsed = adapter.optionsSchema.safeParse(dest.options ?? {});
      if (!parsed.success) {
        throw new AppError('VALIDATION_FAILED', `Check the ${platform.name} settings.`, HttpStatus.UNPROCESSABLE_ENTITY, parsed.error.issues.map((issue) => ({
          path: `destinations.${index}.options.${issue.path.join('.')}`,
          message: issue.message,
        })));
      }
      const options = { ...parsed.data };
      if (!this.config.isFakeProviders) delete options.fake;

      const pf = await this.prisma.platformFeature.findFirstOrThrow({ where: { platformId: platform.id, feature: { code: 'publish' } } });
      const publishConfig = pf.config as unknown as PublishConfig;
      const text = { title: dest.titleOverride ?? body.title, caption: dest.captionOverride ?? body.caption };
      this.checkTextLimits(platform.name, publishConfig.limits, text, index);
      const textProblems = adapter.validate(probe ?? ({} as ProbeResult), text, publishConfig.mediaRules);
      if (textProblems.length > 0) {
        throw new AppError('TEXT_LIMIT', textProblems[0].message, HttpStatus.UNPROCESSABLE_ENTITY, { destination: index, issues: textProblems });
      }

      let status: 'QUEUED' | 'PENDING_MEDIA' = 'PENDING_MEDIA';
      if (probe) {
        const issues = validateMedia(probe, publishConfig.mediaRules, platform.name);
        const decision = decideMediaUse(issues);
        if (decision === 'incompatible') {
          incompatible.push({ socialAccountId: account.id, platform: platform.code, issues: issues.filter((i) => !i.fixableByTranscode) });
          continue;
        }
        if (decision === 'original' && policy !== 'always') status = 'QUEUED';
      }

      plans.push({
        socialAccountId: account.id,
        platformId: platform.id,
        platformCode: platform.code,
        status,
        titleOverride: dest.titleOverride ?? null,
        captionOverride: dest.captionOverride ?? null,
        options: toJsonValue(options) as Prisma.InputJsonValue,
      });
    }

    if (incompatible.length > 0) {
      const first = incompatible[0];
      throw new AppError('MEDIA_INCOMPATIBLE', first.issues[0]?.message ?? 'This video is not compatible with a selected platform.', HttpStatus.UNPROCESSABLE_ENTITY, incompatible);
    }

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          userId,
          mediaId: media.id,
          title: body.title ?? null,
          caption: body.caption ?? null,
          idempotencyKey,
          requestHash,
          status: 'PUBLISHING',
          publications: { createMany: { data: plans.map(({ platformCode: _code, ...rest }) => rest) } },
        },
        include: postViewInclude,
      });
      await this.audit.record(
        { actorUserId: userId, action: 'post.created', entityType: 'post', entityId: created.id, newValue: { destinations: plans.map((p) => p.platformCode), mediaId: media.id }, meta },
        tx,
      );
      return created;
    });

    for (const pub of post.publications) {
      if (pub.status === 'QUEUED') await this.runner.enqueueRun(pub.platform.code, pub.id);
    }
    if (media.status === 'READY' && post.publications.some((p) => p.status === 'PENDING_MEDIA')) {
      await this.mediaProcessing.releasePendingPublications(media.id);
    }
    this.logger.log(`Post ${post.id} created for ${plans.map((p) => p.platformCode).join(', ')}`);
    return { created: true, post: await this.get(userId, post.id) };
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<PostListResponse> {
    const take = Math.min(Math.max(limit, 1), 50);
    const posts = await this.prisma.post.findMany({
      where: { userId },
      include: postViewInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = posts.length > take;
    const items = posts.slice(0, take).map(toPostView);
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async get(userId: string, postId: string): Promise<PostView> {
    const post = await this.prisma.post.findFirst({ where: { id: postId, userId }, include: postViewInclude });
    if (!post) throw notFound('Post');
    return toPostView(post);
  }

  async retry(userId: string, publicationId: string, meta: RequestMeta): Promise<PostView> {
    const pub = await this.ownedPublication(userId, publicationId);
    await this.entitlements.assert(userId, `${pub.platform.code}.publish`);
    const checkpoint = this.repo.checkpointOf(pub);
    if (checkpoint.hadUnknownOutcome) throw actionNotAllowed('Confirm whether this was posted before publishing again.');
    if (!['NEEDS_USER_ACTION', 'FAILED_FINAL', 'RETRY_SCHEDULED'].includes(pub.status)) throw actionNotAllowed('This publication cannot be retried right now.');
    if (pub.socialAccount.status !== 'ACTIVE') throw actionNotAllowed(`Reconnect ${pub.platform.name} before retrying.`);

    const { pub: updated, events } = await this.repo.transition(pub, 'QUEUED', {
      attemptCount: 0,
      nextAttemptAt: null,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      providerErrorCode: null,
    });
    await this.audit.record({ actorUserId: userId, action: 'publication.retry', entityType: 'publication', entityId: pub.id, oldValue: { status: pub.status, errorCode: pub.errorCode }, meta });
    if (events.postBecameTerminal) await this.events.postCompleted(events.postBecameTerminal.postId);
    await this.runner.enqueueRun(updated.platform.code, updated.id);
    return this.get(userId, pub.postId);
  }

  async cancel(userId: string, publicationId: string, meta: RequestMeta): Promise<PostView> {
    const pub = await this.ownedPublication(userId, publicationId);
    if (!['PENDING_MEDIA', 'QUEUED', 'RETRY_SCHEDULED', 'PAUSED', 'NEEDS_USER_ACTION'].includes(pub.status)) {
      throw actionNotAllowed('This publication can no longer be cancelled.');
    }
    const { events } = await this.repo.transition(pub, 'CANCELLED', { nextAttemptAt: null });
    await this.audit.record({ actorUserId: userId, action: 'publication.cancel', entityType: 'publication', entityId: pub.id, oldValue: { status: pub.status }, meta });
    if (events.postBecameTerminal) await this.events.postCompleted(events.postBecameTerminal.postId);
    return this.get(userId, pub.postId);
  }

  async cancelPost(userId: string, postId: string, meta: RequestMeta): Promise<PostView> {
    const post = await this.prisma.post.findFirst({ where: { id: postId, userId }, include: { publications: true } });
    if (!post) throw notFound('Post');
    for (const p of post.publications) {
      if (['PENDING_MEDIA', 'QUEUED', 'RETRY_SCHEDULED', 'PAUSED', 'NEEDS_USER_ACTION'].includes(p.status)) {
        await this.cancel(userId, p.id, meta);
      }
    }
    return this.get(userId, postId);
  }

  async resolve(userId: string, publicationId: string, body: ResolvePublicationRequest, meta: RequestMeta): Promise<PostView> {
    const pub = await this.ownedPublication(userId, publicationId);
    const checkpoint = this.repo.checkpointOf(pub);
    const uncertain = pub.status === 'UNKNOWN_OUTCOME' || (pub.status === 'NEEDS_USER_ACTION' && checkpoint.hadUnknownOutcome);
    if (!uncertain) throw actionNotAllowed('Only publications with an unconfirmed outcome can be resolved.');

    if (body.outcome === 'PUBLISHED') {
      const externalId = body.externalUrl?.split(/[/?#]/).filter(Boolean).pop() ?? `manual-${pub.id}`;
      const { events } = await this.repo.transition(pub, 'PUBLISHED', {
        externalId,
        externalUrl: body.externalUrl ?? null,
        resolvedManually: true,
        publishedAt: new Date(),
        errorCategory: null,
        errorCode: null,
        errorMessage: null,
        checkpoint: { ...checkpoint, inFlight: null, hadUnknownOutcome: false },
      });
      if (events.postBecameTerminal) await this.events.postCompleted(events.postBecameTerminal.postId);
    } else {
      await this.entitlements.assert(userId, `${pub.platform.code}.publish`);
      const fresh: RunnerCheckpoint = { pollCount: 0 };
      const { pub: updated } = await this.repo.transition(pub, 'QUEUED', {
        currentStep: null,
        attemptCount: 0,
        errorCategory: null,
        errorCode: null,
        errorMessage: null,
        checkpoint: fresh,
      });
      await this.runner.enqueueRun(updated.platform.code, updated.id);
    }
    await this.audit.record({ actorUserId: userId, action: 'publication.resolve', entityType: 'publication', entityId: pub.id, newValue: body, meta });
    return this.get(userId, pub.postId);
  }

  private checkTextLimits(platformName: string, limits: PublishConfig['limits'], text: { title?: string; caption?: string }, index: number): void {
    if (limits.titleMaxChars && (text.title?.length ?? 0) > limits.titleMaxChars) {
      throw new AppError('TEXT_LIMIT', `${platformName} titles can be at most ${limits.titleMaxChars} characters.`, HttpStatus.UNPROCESSABLE_ENTITY, { destination: index, field: 'title' });
    }
    if ((text.caption?.length ?? 0) > limits.captionMaxChars) {
      throw new AppError('TEXT_LIMIT', `${platformName} captions can be at most ${limits.captionMaxChars} characters.`, HttpStatus.UNPROCESSABLE_ENTITY, { destination: index, field: 'caption' });
    }
  }

  private async ownedPublication(userId: string, publicationId: string) {
    const pub = await this.prisma.publication.findFirst({ where: { id: publicationId, post: { userId } }, include: publicationInclude });
    if (!pub) throw notFound('Publication');
    return pub;
  }
}
