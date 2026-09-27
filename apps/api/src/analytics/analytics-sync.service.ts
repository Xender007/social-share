import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { addDays } from '../common/time';
import { CredentialsService } from '../connections/credentials.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { JobQueueService, QUEUES } from '../jobs/job-queue.service';
import { KillSwitchService } from '../kill-switches/kill-switch.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnalyticsContext,
  FacebookAnalyticsProvider,
  FakeAnalyticsProvider,
  InstagramAnalyticsProvider,
  MetricPointInput,
  SocialAnalyticsProvider,
  YouTubeAnalyticsProvider,
} from './analytics-providers';

@Injectable()
export class AnalyticsSyncService {
  private readonly logger = new Logger(AnalyticsSyncService.name);
  private readonly providers = new Map<string, SocialAnalyticsProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly credentials: CredentialsService,
    private readonly entitlements: EntitlementsService,
    private readonly killSwitches: KillSwitchService,
    private readonly jobs: JobQueueService,
  ) {
    const live = [new YouTubeAnalyticsProvider(), new InstagramAnalyticsProvider(), new FacebookAnalyticsProvider()];
    for (const provider of live) {
      this.providers.set(provider.platformCode, config.isFakeProviders ? new FakeAnalyticsProvider(provider.platformCode) : provider);
    }
  }

  /** Enqueues account (or publication) syncs for every active account allowed to use analytics. */
  async fanout(kind: 'accounts' | 'recent' | 'older'): Promise<number> {
    const accounts = await this.prisma.socialAccount.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const account of accounts) {
      if (kind === 'accounts') await this.jobs.send(QUEUES.analyticsAccount, { socialAccountId: account.id }, { singletonKey: `analytics-account:${account.id}` });
      else await this.jobs.send(QUEUES.analyticsPublications, { socialAccountId: account.id, tier: kind }, { singletonKey: `analytics-pubs:${kind}:${account.id}` });
    }
    return accounts.length;
  }

  /** Manual "sync now" from the app. */
  async syncUser(userId: string): Promise<{ accounts: number }> {
    const accounts = await this.prisma.socialAccount.findMany({ where: { userId, status: 'ACTIVE' }, select: { id: true } });
    for (const account of accounts) {
      await this.syncAccount(account.id);
      await this.syncPublications(account.id, 'recent');
      await this.syncPublications(account.id, 'older');
    }
    return { accounts: accounts.length };
  }

  async syncAccount(socialAccountId: string): Promise<void> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: socialAccountId }, include: { platform: true } });
    if (!account || account.status !== 'ACTIVE' || !(await this.allowed(account.userId, account.platform.code))) return;
    const provider = this.providers.get(account.platform.code);
    if (!provider) return;

    const run = await this.prisma.syncRun.create({ data: { kind: 'account', socialAccountId, status: 'RUNNING' } });
    try {
      const until = new Date();
      const since = account.lastMetricsSyncedAt ? addDays(until, -3) : addDays(until, this.config.isFakeProviders ? -90 : -28);
      const points = await provider.syncAccount(this.context(account), { since, until });
      const stored = await this.store(points);
      await this.prisma.socialAccount.update({ where: { id: socialAccountId }, data: { lastMetricsSyncedAt: until } });
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', itemsProcessed: stored, finishedAt: new Date() } });
    } catch (error) {
      this.logger.warn(`Account analytics sync failed for ${socialAccountId}: ${(error as Error).message}`);
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (error as Error).message.slice(0, 500), finishedAt: new Date() } });
    }
  }

  async syncPublications(socialAccountId: string, tier: 'recent' | 'older'): Promise<void> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: socialAccountId }, include: { platform: true } });
    if (!account || account.status !== 'ACTIVE' || !(await this.allowed(account.userId, account.platform.code))) return;
    const provider = this.providers.get(account.platform.code);
    if (!provider) return;

    const now = new Date();
    const window = tier === 'recent' ? { gte: addDays(now, -7) } : { gte: addDays(now, -90), lt: addDays(now, -7) };
    const publications = await this.prisma.publication.findMany({
      where: { socialAccountId, status: 'PUBLISHED', externalId: { not: null }, resolvedManually: false, publishedAt: window },
      select: { id: true, externalId: true, publishedAt: true },
    });
    if (publications.length === 0) return;

    const run = await this.prisma.syncRun.create({ data: { kind: `publications-${tier}`, socialAccountId, status: 'RUNNING' } });
    try {
      const points = await provider.syncPublications(
        this.context(account),
        publications.map((p) => ({ id: p.id, externalId: p.externalId!, publishedAt: p.publishedAt! })),
      );
      const stored = await this.store(points);
      await this.prisma.publication.updateMany({ where: { id: { in: publications.map((p) => p.id) } }, data: { lastMetricsSyncedAt: now } });
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', itemsProcessed: stored, finishedAt: new Date() } });
    } catch (error) {
      this.logger.warn(`Publication analytics sync failed for ${socialAccountId}: ${(error as Error).message}`);
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (error as Error).message.slice(0, 500), finishedAt: new Date() } });
    }
  }

  /** Idempotent upserts keyed by (entity, metric, bucket); unknown or disabled metrics are ignored. */
  async store(points: MetricPointInput[]): Promise<number> {
    if (points.length === 0) return 0;
    const known = new Set((await this.prisma.metricDefinition.findMany({ where: { enabled: true }, select: { key: true } })).map((m) => m.key));
    const valid = points.filter((p) => known.has(p.metricKey) && Number.isFinite(p.value));
    for (let i = 0; i < valid.length; i += 200) {
      await this.prisma.$transaction(
        valid.slice(i, i + 200).map((p) =>
          p.entity === 'ACCOUNT'
            ? this.prisma.accountMetricPoint.upsert({
                where: { socialAccountId_metricKey_bucketKey: { socialAccountId: p.entityId, metricKey: p.metricKey, bucketKey: p.bucketKey } },
                create: { socialAccountId: p.entityId, metricKey: p.metricKey, bucketKey: p.bucketKey, bucketStart: p.bucketStart, value: p.value },
                update: { value: p.value, capturedAt: new Date() },
              })
            : this.prisma.publicationMetricPoint.upsert({
                where: { publicationId_metricKey_bucketKey: { publicationId: p.entityId, metricKey: p.metricKey, bucketKey: p.bucketKey } },
                create: { publicationId: p.entityId, metricKey: p.metricKey, bucketKey: p.bucketKey, bucketStart: p.bucketStart, value: p.value },
                update: { value: p.value, capturedAt: new Date() },
              }),
        ),
      );
    }
    return valid.length;
  }

  private async allowed(userId: string, platformCode: string): Promise<boolean> {
    if (await this.killSwitches.blocks(platformCode, 'analytics')) return false;
    return this.entitlements.can(userId, `${platformCode}.analytics`);
  }

  private context(account: { id: string; externalAccountId: string; connectedAt: Date; metadata: unknown; platform: { config: unknown } }): AnalyticsContext {
    return {
      account: { id: account.id, externalAccountId: account.externalAccountId, createdAt: account.connectedAt, metadata: (account.metadata ?? {}) as Record<string, unknown> },
      credentials: () => this.credentials.forSocialAccount(account.id),
      apiVersion: ((account.platform.config ?? {}) as { apiVersion?: string }).apiVersion ?? this.config.env.META_GRAPH_API_VERSION,
    };
  }
}
