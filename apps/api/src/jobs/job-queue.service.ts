import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss, type Job, type Queue } from 'pg-boss';
import { AppConfig } from '../config/app-config';

export const QUEUES = {
  publicationRun: (platformCode: string) => `publication.run.${platformCode}`,
  publicationReconcile: 'publication.reconcile',
  mediaProbe: 'media.probe',
  mediaTranscode: 'media.transcode',
  notificationsSend: 'notifications.send',
  analyticsAccount: 'analytics.account',
  analyticsPublications: 'analytics.publications',
  cronSweeper: 'cron.sweeper',
  cronMediaCleanup: 'cron.media-cleanup',
  cronRetention: 'cron.retention',
  cronConnectionsHealth: 'cron.connections-health',
  cronAnalyticsAccounts: 'cron.analytics-accounts',
  cronAnalyticsRecent: 'cron.analytics-recent',
  cronAnalyticsOlder: 'cron.analytics-older',
} as const;

export interface SendJobOptions {
  /** Date, or seconds from now. */
  startAfter?: Date | number;
  singletonKey?: string;
  retryLimit?: number;
}

export interface QueueSummary {
  name: string;
  queued: number;
  ready: number;
  active: number;
  failed: number;
}

/** Thin wrapper over pg-boss so business code never depends on the queue library directly (ADR-1). */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private boss: PgBoss | null = null;
  private readonly queueNames = new Set<string>();

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const boss = new PgBoss({
      connectionString: this.config.pgBossUrl,
      schema: 'pgboss',
      max: 5,
      schedule: this.config.runsWorker,
    });
    boss.on('error', (error: unknown) => this.logger.error(`pg-boss: ${(error as Error)?.message ?? String(error)}`));
    await boss.start();
    this.boss = boss;
    this.logger.log(`Job queue started (worker=${this.config.runsWorker})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 30_000 });
    this.boss = null;
  }

  isStarted(): boolean {
    return this.boss !== null;
  }

  private get instance(): PgBoss {
    if (!this.boss) throw new Error('Job queue is not started');
    return this.boss;
  }

  async ensureQueue(name: string, options: Omit<Queue, 'name'> = {}): Promise<void> {
    if (this.queueNames.has(name)) return;
    const existing = await this.instance.getQueue(name);
    if (existing) {
      // pg-boss forbids changing a queue's policy after creation; update everything else.
      const { policy, partition: _partition, ...updatable } = options;
      if (policy && existing.policy !== policy) this.logger.warn(`Queue ${name} keeps policy ${existing.policy} (requested ${policy})`);
      await this.instance.updateQueue(name, updatable);
    } else {
      await this.instance.createQueue(name, options);
    }
    this.queueNames.add(name);
  }

  async send(name: string, data: object, options: SendJobOptions = {}): Promise<string | null> {
    await this.ensureQueue(name, name.startsWith('publication.run.') ? { policy: 'stately' } : {});
    // pg-boss validates keys that are present, so only pass options that are actually set.
    const sendOptions: { singletonKey?: string; retryLimit?: number; startAfter?: Date | number } = {};
    if (options.singletonKey !== undefined) sendOptions.singletonKey = options.singletonKey;
    if (options.retryLimit !== undefined) sendOptions.retryLimit = options.retryLimit;
    if (options.startAfter !== undefined) sendOptions.startAfter = options.startAfter;
    return this.instance.send(name, data, sendOptions);
  }

  async work<T extends object>(
    name: string,
    options: { concurrency: number; pollingIntervalSeconds?: number },
    handler: (data: T, job: Job<T>) => Promise<void>,
  ): Promise<void> {
    await this.instance.work<T>(
      name,
      { localConcurrency: options.concurrency, batchSize: 1, pollingIntervalSeconds: options.pollingIntervalSeconds ?? 1 },
      async (jobs: Job<T>[]) => {
        for (const job of jobs) await handler(job.data, job);
      },
    );
  }

  async schedule(name: string, cron: string, data: object = {}): Promise<void> {
    await this.ensureQueue(name, { policy: 'singleton', retryLimit: 0 });
    await this.instance.schedule(name, cron, data, { tz: 'UTC' });
  }

  async summaries(): Promise<QueueSummary[]> {
    if (!this.boss) return [];
    const queues = await this.instance.getQueues();
    return queues
      .filter((q) => !q.name.startsWith('__'))
      .map((q) => ({ name: q.name, queued: q.queuedCount, ready: q.readyCount, active: q.activeCount, failed: q.failedCount }));
  }
}

@Global()
@Module({ providers: [JobQueueService], exports: [JobQueueService] })
export class JobsModule {}
