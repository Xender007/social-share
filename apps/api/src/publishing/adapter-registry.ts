import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { FakePublisher } from '../publishers/fake/fake.publisher';
import { FacebookPublisher } from '../publishers/facebook/facebook.publisher';
import { InstagramPublisher } from '../publishers/instagram/instagram.publisher';
import { OPTION_SCHEMAS } from '../publishers/option-schemas';
import type { SocialPublisher } from '../publishers/types';
import { YouTubePublisher } from '../publishers/youtube/youtube.publisher';

/** Maps platform codes to publisher adapters. PROVIDER_MODE=fake swaps every adapter for the fake one. */
@Injectable()
export class AdapterRegistry implements OnModuleInit {
  private readonly logger = new Logger(AdapterRegistry.name);
  private readonly publishers = new Map<string, SocialPublisher>();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    const live: SocialPublisher[] = [new YouTubePublisher(), new InstagramPublisher(), new FacebookPublisher()];
    for (const adapter of live) {
      this.publishers.set(
        adapter.platformCode,
        config.isFakeProviders ? new FakePublisher(adapter.platformCode, OPTION_SCHEMAS[adapter.platformCode]!, config.env.NODE_ENV === 'test' ? 50 : 2000) : adapter,
      );
    }
  }

  /** Fails fast when an enabled platform has no adapter (§19.4). */
  async onModuleInit(): Promise<void> {
    const enabled = await this.prisma.platform.findMany({ where: { enabled: true }, select: { code: true } });
    const missing = enabled.filter((p) => !this.publishers.has(p.code)).map((p) => p.code);
    if (missing.length > 0) throw new Error(`Enabled platforms without a publisher adapter: ${missing.join(', ')}`);
    this.logger.log(`Publishers ready (${this.config.env.PROVIDER_MODE} mode): ${[...this.publishers.keys()].join(', ')}`);
  }

  publisher(platformCode: string): SocialPublisher {
    const adapter = this.publishers.get(platformCode);
    if (!adapter) throw new Error(`No publisher adapter for platform ${platformCode}`);
    return adapter;
  }

  has(platformCode: string): boolean {
    return this.publishers.has(platformCode);
  }
}
