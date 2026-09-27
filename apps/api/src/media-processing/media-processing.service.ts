import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppConfig } from '../config/app-config';
import { addDays } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import { JobQueueService, QUEUES } from '../jobs/job-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../publishing/adapter-registry';
import { PublicationRepository, publicationInclude, PublicationRow } from '../publishing/publication.repository';
import { PublishingEvents } from '../publishing/publishing-events.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { parseFfprobe, runFfprobe } from './probe';
import { decideMediaUse, expectedVariantProbe, MediaRules, ProbeResult, validateMedia } from './rules';
import { buildTranscodeArgs } from './transcode';

const execFileAsync = promisify(execFile);

@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly registry: AdapterRegistry,
    private readonly jobs: JobQueueService,
    private readonly repo: PublicationRepository,
    private readonly events: PublishingEvents,
  ) {}

  /** media.probe job: reads the uploaded object with ffprobe and records what it really is. */
  async probe(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || (media.status !== 'UPLOADED' && media.status !== 'PROBING')) return;
    await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'PROBING' } });

    let probe: ProbeResult;
    try {
      const url = await this.storage.signedGetUrl(media.storageKey, 900, 'internal');
      probe = parseFfprobe(await runFfprobe(this.config.env.FFPROBE_PATH, url));
      probe.sizeBytes = Number(media.sizeBytes ?? media.declaredSizeBytes);
    } catch (error) {
      this.logger.warn(`ffprobe failed for ${mediaId}: ${(error as Error).message}`);
      await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'INVALID', invalidReason: 'UNREADABLE' } });
      await this.releasePendingPublications(mediaId);
      return;
    }

    if (!probe.videoCodec) {
      await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'INVALID', invalidReason: 'NO_VIDEO_STREAM', probe: probe as unknown as Prisma.InputJsonValue } });
      await this.releasePendingPublications(mediaId);
      return;
    }

    await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        status: 'READY',
        container: probe.container,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        hasAudio: probe.hasAudio,
        width: probe.width,
        height: probe.height,
        rotation: probe.rotation,
        durationMs: probe.durationMs,
        frameRate: probe.frameRate,
        isVariableFrameRate: probe.isVariableFrameRate,
        isHdr: probe.isHdr,
        bitDepth: probe.bitDepth,
        probe: probe as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.log(`Media ${mediaId} ready: ${probe.videoCodec} ${probe.width}x${probe.height} ${probe.durationMs}ms hdr=${probe.isHdr}`);
    await this.releasePendingPublications(mediaId);
  }

  /** Decides, per waiting publication, whether it can use the original, needs the variant, or can't publish at all. */
  async releasePendingPublications(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUniqueOrThrow({ where: { id: mediaId }, include: { variants: true } });
    const pending = await this.prisma.publication.findMany({ where: { post: { mediaId }, status: 'PENDING_MEDIA' }, include: publicationInclude });
    if (pending.length === 0) return;

    if (media.status === 'INVALID' || media.status === 'DELETED') {
      for (const pub of pending) {
        await this.apply(pub, 'NEEDS_USER_ACTION', {
          errorCategory: 'MEDIA_INVALID',
          errorCode: `MEDIA_${media.invalidReason ?? 'INVALID'}`,
          errorMessage: "This video file couldn't be read. Try exporting it again.",
        });
      }
      return;
    }
    if (media.status !== 'READY') return;

    const probe = media.probe as unknown as ProbeResult;
    const policy = await this.settings.get('transcode_policy');
    const variant = media.variants.find((v) => v.kind === 'H264_SDR');
    let needVariantJob = false;

    for (const pub of pending) {
      const rules = await this.rulesFor(pub.platformId);
      const adapter = this.registry.publisher(pub.platform.code);
      const providerRejected = pub.errorCategory === 'MEDIA_INVALID';
      const originalIssues = validateMedia(probe, rules, pub.platform.name);
      const decision = decideMediaUse(originalIssues);
      const textIssues = adapter.validate(probe, { title: pub.titleOverride ?? pub.post.title ?? undefined, caption: pub.captionOverride ?? pub.post.caption ?? undefined }, rules);

      if (textIssues.length > 0) {
        await this.apply(pub, 'NEEDS_USER_ACTION', { errorCategory: 'VALIDATION', errorCode: textIssues[0].code, errorMessage: textIssues[0].message });
        continue;
      }
      if (decision === 'incompatible') {
        const blocking = originalIssues.filter((i) => !i.fixableByTranscode);
        await this.apply(pub, 'NEEDS_USER_ACTION', { errorCategory: 'MEDIA_INVALID', errorCode: blocking[0].code, errorMessage: blocking.map((i) => i.message).join(' ') });
        continue;
      }

      const wantsVariant = policy === 'always' || providerRejected || (decision === 'variant' && policy !== 'never');
      if (!wantsVariant) {
        if (decision === 'variant') {
          await this.apply(pub, 'NEEDS_USER_ACTION', { errorCategory: 'MEDIA_INVALID', errorCode: originalIssues[0].code, errorMessage: originalIssues.map((i) => i.message).join(' ') });
          continue;
        }
        await this.queue(pub, null);
        continue;
      }

      if (validateMedia(expectedVariantProbe(probe), rules, pub.platform.name).some((i) => !i.fixableByTranscode)) {
        await this.apply(pub, 'NEEDS_USER_ACTION', { errorCategory: 'MEDIA_INVALID', errorCode: 'VARIANT_INCOMPATIBLE', errorMessage: `This video can't be converted into a format ${pub.platform.name} accepts.` });
        continue;
      }
      if (variant?.status === 'READY') {
        if (providerRejected && pub.mediaVariantId === variant.id) {
          await this.apply(pub, 'NEEDS_USER_ACTION', { errorCategory: 'MEDIA_INVALID', errorCode: pub.errorCode ?? 'PROVIDER_REJECTED', errorMessage: pub.errorMessage ?? `${pub.platform.name} rejected the converted video.` });
        } else {
          await this.queue(pub, variant.id);
        }
      } else if (variant?.status === 'FAILED') {
        await this.apply(pub, 'NEEDS_USER_ACTION', { errorCategory: 'MEDIA_INVALID', errorCode: 'TRANSCODE_FAILED', errorMessage: "We couldn't convert this video. Try exporting it as H.264 MP4." });
      } else {
        needVariantJob = true;
      }
    }

    if (needVariantJob) {
      await this.prisma.mediaVariant.upsert({
        where: { mediaId_kind: { mediaId, kind: 'H264_SDR' } },
        create: { mediaId, kind: 'H264_SDR', storageKey: media.storageKey.replace(/original\.[^.]+$/, 'variants/h264_sdr.mp4'), status: 'PROCESSING' },
        update: {},
      });
      await this.jobs.send(QUEUES.mediaTranscode, { mediaId }, { singletonKey: `transcode:${mediaId}` });
    }
  }

  /** media.transcode job: builds the H.264 SDR variant with ffmpeg. */
  async transcode(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.status !== 'READY') return;
    const variantKey = media.storageKey.replace(/original\.[^.]+$/, 'variants/h264_sdr.mp4');
    const variant = await this.prisma.mediaVariant.upsert({
      where: { mediaId_kind: { mediaId, kind: 'H264_SDR' } },
      create: { mediaId, kind: 'H264_SDR', storageKey: variantKey, status: 'PROCESSING' },
      update: {},
    });
    if (variant.status === 'READY') return this.releasePendingPublications(mediaId);

    const workDir = join(this.config.env.MEDIA_TMP_DIR, `transcode-${mediaId}`);
    const output = join(workDir, 'h264_sdr.mp4');
    const started = Date.now();
    try {
      await mkdir(workDir, { recursive: true });
      const input = await this.storage.signedGetUrl(media.storageKey, 3600, 'internal');
      const probe = media.probe as unknown as ProbeResult;
      await execFileAsync(this.config.env.FFMPEG_PATH, buildTranscodeArgs(probe, input, output), {
        timeout: 30 * 60_000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      });
      const outProbe = parseFfprobe(await runFfprobe(this.config.env.FFPROBE_PATH, output));
      const size = await this.storage.uploadFile(variant.storageKey, output, 'video/mp4');
      outProbe.sizeBytes = size;
      await this.prisma.mediaVariant.update({
        where: { id: variant.id },
        data: { status: 'READY', sizeBytes: BigInt(size), probe: outProbe as unknown as Prisma.InputJsonValue, readyAt: new Date(), error: null },
      });
      this.logger.log(`Transcoded ${mediaId} in ${Math.round((Date.now() - started) / 1000)}s (${Math.round(size / 1024 / 1024)} MB)`);
    } catch (error) {
      const message = (error as Error).message.slice(-500);
      this.logger.error(`Transcode failed for ${mediaId}: ${message}`);
      await this.prisma.mediaVariant.update({ where: { id: variant.id }, data: { status: 'FAILED', error: message } });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
    await this.releasePendingPublications(mediaId);
  }

  /** Daily media.cleanup (§15.6). */
  async cleanup(): Promise<{ deleted: number; aborted: number }> {
    const [retentionDays, orphanDays] = await Promise.all([this.settings.get('media_retention_days'), this.settings.get('media_orphan_days')]);
    const now = new Date();
    let deleted = 0;
    let aborted = 0;

    const stalePending = await this.prisma.media.findMany({ where: { status: 'PENDING_UPLOAD', createdAt: { lt: addDays(now, -1) } } });
    for (const media of stalePending) {
      if (media.multipartUploadId) await this.storage.abortMultipartUpload(media.storageKey, media.multipartUploadId);
      await this.prisma.media.update({ where: { id: media.id }, data: { status: 'DELETED', deletedAt: now, multipartUploadId: null } });
      aborted += 1;
    }

    const candidates = await this.prisma.media.findMany({
      where: { status: { in: ['READY', 'UPLOADED', 'INVALID'] }, deletedAt: null },
      include: { variants: true, posts: { include: { publications: { select: { status: true, updatedAt: true } } } } },
    });
    for (const media of candidates) {
      const publications = media.posts.flatMap((p) => p.publications);
      const orphan = publications.length === 0 && media.createdAt < addDays(now, -orphanDays);
      const allTerminal = publications.length > 0 && publications.every((p) => ['PUBLISHED', 'FAILED_FINAL', 'CANCELLED'].includes(p.status));
      const lastChange = publications.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), new Date(0));
      const expired = allTerminal && lastChange < addDays(now, -retentionDays);
      if (!orphan && !expired) continue;
      await this.storage.deleteObjects([media.storageKey, ...media.variants.map((v) => v.storageKey)]).catch(() => undefined);
      await this.prisma.media.update({ where: { id: media.id }, data: { status: 'DELETED', deletedAt: now } });
      deleted += 1;
    }
    if (deleted || aborted) this.logger.log(`Media cleanup: deleted ${deleted}, aborted ${aborted}`);
    return { deleted, aborted };
  }

  private async rulesFor(platformId: string): Promise<MediaRules> {
    const pf = await this.prisma.platformFeature.findFirstOrThrow({ where: { platformId, feature: { code: 'publish' } } });
    return (pf.config as unknown as { mediaRules: MediaRules }).mediaRules;
  }

  private async queue(pub: PublicationRow, variantId: string | null): Promise<void> {
    const updated = await this.apply(pub, 'QUEUED', { mediaVariantId: variantId, errorCategory: null, errorCode: null, errorMessage: null, providerErrorCode: null });
    await this.jobs.send(QUEUES.publicationRun(updated.platform.code), { publicationId: updated.id }, { singletonKey: `run:${updated.id}` });
  }

  private async apply(pub: PublicationRow, to: 'QUEUED' | 'NEEDS_USER_ACTION', patch: Parameters<PublicationRepository['transition']>[2]): Promise<PublicationRow> {
    const { pub: updated, events } = await this.repo.transition(pub, to, patch);
    if (events.needsAction) await this.events.publicationNeedsAction(updated);
    if (events.postBecameTerminal) await this.events.postCompleted(events.postBecameTerminal.postId);
    return updated;
  }
}
