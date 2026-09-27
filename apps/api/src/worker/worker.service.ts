import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AnalyticsSyncService } from '../analytics/analytics-sync.service';
import { addDays, addMinutes } from '../common/time';
import { AppConfig } from '../config/app-config';
import { ConnectionsService } from '../connections/connections.service';
import { JobQueueService, QUEUES } from '../jobs/job-queue.service';
import { MediaProcessingService } from '../media-processing/media-processing.service';
import { NotificationsService, type PushEvent } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../publishing/adapter-registry';
import { PublicationRunner } from '../publishing/publication-runner.service';
import { SettingsService } from '../settings/settings.service';

const PLATFORM_CONCURRENCY: Record<string, { concurrency: number; expireInSeconds: number }> = {
  youtube: { concurrency: 1, expireInSeconds: 1800 },
  instagram: { concurrency: 2, expireInSeconds: 600 },
  facebook: { concurrency: 2, expireInSeconds: 900 },
};

/** Registers pg-boss workers and crons when this process runs the worker role (§17). */
@Injectable()
export class WorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobQueueService,
    private readonly prisma: PrismaService,
    private readonly registry: AdapterRegistry,
    private readonly runner: PublicationRunner,
    private readonly media: MediaProcessingService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsSyncService,
    private readonly connections: ConnectionsService,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.runsWorker) return;

    for (const [platform, opts] of Object.entries(PLATFORM_CONCURRENCY)) {
      if (!this.registry.has(platform)) continue;
      const name = QUEUES.publicationRun(platform);
      await this.jobs.ensureQueue(name, { policy: 'stately', retryLimit: 1, retryDelay: 30, expireInSeconds: opts.expireInSeconds });
      await this.jobs.work<{ publicationId: string }>(name, { concurrency: opts.concurrency }, (data, job) => this.runner.run(data.publicationId, job.id));
    }

    await this.jobs.ensureQueue(QUEUES.publicationReconcile, { policy: 'stately', retryLimit: 2, retryDelay: 30 });
    await this.jobs.work<{ publicationId: string }>(QUEUES.publicationReconcile, { concurrency: 2 }, (data) => this.runner.reconcile(data.publicationId));

    await this.jobs.ensureQueue(QUEUES.mediaProbe, { retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 300 });
    await this.jobs.work<{ mediaId: string }>(QUEUES.mediaProbe, { concurrency: 2 }, (data) => this.media.probe(data.mediaId));

    await this.jobs.ensureQueue(QUEUES.mediaTranscode, { policy: 'stately', retryLimit: 1, retryDelay: 60, expireInSeconds: 3600 });
    await this.jobs.work<{ mediaId: string }>(QUEUES.mediaTranscode, { concurrency: 1 }, (data) => this.media.transcode(data.mediaId));

    await this.jobs.ensureQueue(QUEUES.notificationsSend, { retryLimit: 3, retryDelay: 15, retryBackoff: true });
    await this.jobs.work<PushEvent>(QUEUES.notificationsSend, { concurrency: 4 }, async (data) => {
      await this.notifications.send(data);
    });

    await this.jobs.ensureQueue(QUEUES.analyticsAccount, { policy: 'stately', retryLimit: 2, retryDelay: 60 });
    await this.jobs.work<{ socialAccountId: string }>(QUEUES.analyticsAccount, { concurrency: 2, pollingIntervalSeconds: 5 }, (data) => this.analytics.syncAccount(data.socialAccountId));
    await this.jobs.ensureQueue(QUEUES.analyticsPublications, { policy: 'stately', retryLimit: 2, retryDelay: 60 });
    await this.jobs.work<{ socialAccountId: string; tier: 'recent' | 'older' }>(QUEUES.analyticsPublications, { concurrency: 1, pollingIntervalSeconds: 5 }, (data) =>
      this.analytics.syncPublications(data.socialAccountId, data.tier),
    );

    const s = await this.settings.getAll();
    const crons: Array<[string, string, () => Promise<unknown>]> = [
      [QUEUES.cronSweeper, '* * * * *', () => this.sweep()],
      [QUEUES.cronMediaCleanup, '0 4 * * *', () => this.media.cleanup()],
      [QUEUES.cronRetention, '30 4 * * *', () => this.retention()],
      [QUEUES.cronConnectionsHealth, '0 6 * * *', () => this.connections.checkHealth()],
      [QUEUES.cronAnalyticsAccounts, s.analytics_account_sync, () => this.analytics.fanout('accounts')],
      [QUEUES.cronAnalyticsRecent, s.analytics_recent_sync, () => this.analytics.fanout('recent')],
      [QUEUES.cronAnalyticsOlder, s.analytics_older_sync, () => this.analytics.fanout('older')],
    ];
    for (const [name, cron, handler] of crons) {
      await this.jobs.schedule(name, cron);
      await this.jobs.work(name, { concurrency: 1, pollingIntervalSeconds: 10 }, async () => {
        await handler();
      });
    }

    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(`Initial sweep failed: ${(error as Error).message}`);
    }
    this.logger.log('Workers and schedules registered');
  }

  /** Makes the database the source of truth: anything due but not queued gets enqueued (§17.4). */
  async sweep(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.publication.findMany({
      where: {
        OR: [
          { status: 'QUEUED', updatedAt: { lt: new Date(now.getTime() - 20_000) } },
          { status: { in: ['RETRY_SCHEDULED', 'WAITING_PROVIDER'] }, nextAttemptAt: { lte: now } },
          { status: 'IN_PROGRESS', updatedAt: { lt: addMinutes(now, -10) } },
        ],
      },
      select: { id: true, platform: { select: { code: true } } },
      take: 200,
    });
    for (const pub of due) await this.runner.enqueueRun(pub.platform.code, pub.id);

    const uncertain = await this.prisma.publication.findMany({ where: { status: 'UNKNOWN_OUTCOME', updatedAt: { lt: addMinutes(now, -2) } }, select: { id: true }, take: 50 });
    for (const pub of uncertain) await this.jobs.send(QUEUES.publicationReconcile, { publicationId: pub.id }, { singletonKey: `reconcile:${pub.id}` });

    const media = await this.prisma.media.findMany({
      where: { OR: [{ status: 'UPLOADED', uploadedAt: { lt: addMinutes(now, -1) } }, { status: 'PROBING', uploadedAt: { lt: addMinutes(now, -10) } }] },
      select: { id: true },
      take: 50,
    });
    for (const m of media) await this.jobs.send(QUEUES.mediaProbe, { mediaId: m.id }, { singletonKey: `probe:${m.id}` });
  }

  /** Daily retention (§17.3): raw responses, expired OAuth states, old sessions, snapshot downsampling. */
  async retention(): Promise<void> {
    const now = new Date();
    const s = await this.settings.getAll();
    await this.prisma.providerRawResponse.deleteMany({ where: { capturedAt: { lt: addDays(now, -s.raw_response_retention_days) } } });
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: addDays(now, -1) } } });
    await this.prisma.refreshSession.deleteMany({ where: { OR: [{ revokedAt: { lt: addDays(now, -30) } }, { expiresAt: { lt: addDays(now, -30) } }] } });
    const cutoff = addDays(now, -s.snapshot_downsample_days);
    const removed = await this.prisma.$executeRaw`
      DELETE FROM account_metric_points a USING account_metric_points b
      WHERE a.social_account_id = b.social_account_id
        AND a.metric_key = b.metric_key
        AND date_trunc('day', a.bucket_start) = date_trunc('day', b.bucket_start)
        AND a.bucket_start < b.bucket_start
        AND a.bucket_start < ${cutoff}
        AND position('T' in a.bucket_key) > 0`;
    this.logger.log(`Retention complete (downsampled ${removed} snapshot points)`);
  }
}
