import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { CredentialsService } from '../connections/credentials.service';
import type { ProbeResult } from '../media-processing/rules';
import { PrismaService } from '../prisma/prisma.service';
import type { PublishContext, SocialPublisher } from '../publishers/types';
import { StorageService } from '../storage/storage.service';
import type { PublicationRow, RunnerCheckpoint } from './publication.repository';

@Injectable()
export class PublishContextFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly credentials: CredentialsService,
    private readonly config: AppConfig,
  ) {}

  async build(pub: PublicationRow, adapter: SocialPublisher, timeoutMs: number): Promise<PublishContext> {
    const media = await this.prisma.media.findUniqueOrThrow({ where: { id: pub.post.mediaId } });
    const variant = pub.mediaVariant?.status === 'READY' ? pub.mediaVariant : null;
    const storageKey = variant?.storageKey ?? media.storageKey;
    const sizeBytes = Number(variant?.sizeBytes ?? media.sizeBytes ?? 0);
    const probe = ((variant?.probe ?? media.probe) ?? {}) as unknown as ProbeResult;
    const checkpoint = (pub.checkpoint ?? {}) as RunnerCheckpoint;
    const platformConfig = (pub.platform.config ?? {}) as { apiVersion?: string };

    return {
      publication: {
        id: pub.id,
        attemptCount: pub.attemptCount,
        pollCount: checkpoint.pollCount ?? 0,
        waitingSince: pub.waitingSince,
        inFlightStartedAt: checkpoint.inFlight ? new Date(checkpoint.inFlight.startedAt) : null,
      },
      checkpoint: (checkpoint[adapter.platformCode] as Record<string, unknown> | undefined) ?? {},
      account: {
        id: pub.socialAccount.id,
        externalAccountId: pub.socialAccount.externalAccountId,
        displayName: pub.socialAccount.displayName,
        metadata: (pub.socialAccount.metadata ?? {}) as Record<string, unknown>,
      },
      credentials: () => this.credentials.forSocialAccount(pub.socialAccountId),
      media: {
        probe,
        sizeBytes,
        contentType: variant ? 'video/mp4' : media.declaredMimeType,
        signedUrl: (ttlSeconds) => this.storage.signedGetUrl(storageKey, ttlSeconds, 'public'),
        openRange: (start, end) => this.storage.openRange(storageKey, start, end),
      },
      text: {
        title: pub.titleOverride ?? pub.post.title ?? undefined,
        caption: pub.captionOverride ?? pub.post.caption ?? undefined,
      },
      options: (pub.options ?? {}) as Record<string, unknown>,
      config: {
        apiVersion: platformConfig.apiVersion ?? this.config.env.META_GRAPH_API_VERSION,
        apiBaseUrl: this.config.env.API_BASE_URL,
      },
      signal: AbortSignal.timeout(timeoutMs),
    };
  }
}
