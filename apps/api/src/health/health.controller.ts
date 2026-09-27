import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import { JobQueueService } from '../jobs/job-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobQueueService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  live() {
    return { status: 'ok', uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), role: this.config.env.PROCESS_ROLE, providerMode: this.config.env.PROVIDER_MODE };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const encoding = await this.prisma.$queryRaw<Array<{ server_encoding: string }>>`SHOW server_encoding`
      .then((rows) => rows[0]?.server_encoding ?? null)
      .catch(() => null);
    const database = encoding !== null;
    // Captions contain emoji; a non-UTF-8 database silently breaks publishing.
    const utf8 = encoding === 'UTF8';
    const storage = await this.storage.ping();
    const jobs = this.jobs.isStarted();
    const ready = database && utf8 && storage && jobs;
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ready' : 'degraded', checks: { database, utf8, storage, jobs } };
  }
}
