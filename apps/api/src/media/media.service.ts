import { HttpStatus, Injectable } from '@nestjs/common';
import type { MediaResponse, StartUploadRequest, StartUploadResponse, UploadPartUrl } from '@sp/contracts';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { actionNotAllowed, AppError, notFound } from '../common/errors';
import { bigToNumber, iso } from '../common/time';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { Media } from '../generated/prisma/client';
import { JobQueueService, QUEUES } from '../jobs/job-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

const PART_URL_TTL_SECONDS = 3600;
const MAX_PARTS = 10_000;
const MiB = 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.3gp', '.webm', '.mkv']);

export function toMediaResponse(media: Media): MediaResponse {
  return {
    id: media.id,
    status: media.status,
    originalFilename: media.originalFilename,
    sizeBytes: bigToNumber(media.sizeBytes ?? media.declaredSizeBytes),
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    videoCodec: media.videoCodec,
    audioCodec: media.audioCodec,
    frameRate: media.frameRate,
    isHdr: media.isHdr,
    invalidReason: media.invalidReason,
    createdAt: iso(media.createdAt),
  };
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly jobs: JobQueueService,
  ) {}

  async startUpload(userId: string, input: StartUploadRequest): Promise<StartUploadResponse> {
    await this.assertCanPublishSomewhere(userId);
    const maxBytes = await this.settings.get('max_upload_bytes');
    if (input.sizeBytes > maxBytes) {
      throw new AppError('UPLOAD_TOO_LARGE', `Videos can be at most ${Math.round(maxBytes / 1024 ** 3)} GB.`, HttpStatus.PAYLOAD_TOO_LARGE);
    }

    let partSize = await this.settings.get('upload_part_size_bytes');
    if (Math.ceil(input.sizeBytes / partSize) > MAX_PARTS) partSize = Math.ceil(input.sizeBytes / MAX_PARTS / MiB) * MiB;
    const partCount = Math.max(1, Math.ceil(input.sizeBytes / partSize));

    const id = randomUUID();
    const ext = extname(input.filename).toLowerCase();
    const storageKey = `media/${userId}/${id}/original${ALLOWED_EXTENSIONS.has(ext) ? ext : '.mp4'}`;
    const uploadId = await this.storage.createMultipartUpload(storageKey, input.mimeType);

    await this.prisma.media.create({
      data: {
        id,
        userId,
        storageKey,
        multipartUploadId: uploadId,
        originalFilename: input.filename.slice(0, 255),
        declaredMimeType: input.mimeType,
        declaredSizeBytes: BigInt(input.sizeBytes),
        status: 'PENDING_UPLOAD',
      },
    });

    const parts = await this.storage.presignUploadParts(
      storageKey,
      uploadId,
      Array.from({ length: partCount }, (_, i) => i + 1),
      PART_URL_TTL_SECONDS,
    );
    return { mediaId: id, uploadId, partSizeBytes: partSize, partCount, parts, expiresAt: iso(new Date(Date.now() + PART_URL_TTL_SECONDS * 1000)) };
  }

  async presignParts(userId: string, mediaId: string, partNumbers: number[]): Promise<{ parts: UploadPartUrl[]; expiresAt: string }> {
    const media = await this.owned(userId, mediaId);
    if (media.status !== 'PENDING_UPLOAD' || !media.multipartUploadId) throw actionNotAllowed('This upload is no longer in progress.');
    const parts = await this.storage.presignUploadParts(media.storageKey, media.multipartUploadId, partNumbers, PART_URL_TTL_SECONDS);
    return { parts, expiresAt: iso(new Date(Date.now() + PART_URL_TTL_SECONDS * 1000)) };
  }

  async complete(userId: string, mediaId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<MediaResponse> {
    const media = await this.owned(userId, mediaId);
    if (media.status !== 'PENDING_UPLOAD') {
      if (media.status === 'DELETED' || media.status === 'INVALID') throw new AppError('MEDIA_INVALID', 'This upload failed. Please upload the video again.', HttpStatus.UNPROCESSABLE_ENTITY);
      return toMediaResponse(media); // already completed: idempotent
    }
    if (!media.multipartUploadId) throw actionNotAllowed('Upload session is missing.');

    await this.storage.completeMultipartUpload(media.storageKey, media.multipartUploadId, parts);
    const head = await this.storage.head(media.storageKey);
    if (!head || head.sizeBytes !== Number(media.declaredSizeBytes)) {
      await this.storage.deleteObjects([media.storageKey]).catch(() => undefined);
      await this.prisma.media.update({ where: { id: media.id }, data: { status: 'INVALID', invalidReason: 'UPLOAD_SIZE_MISMATCH', multipartUploadId: null } });
      throw new AppError('UPLOAD_SIZE_MISMATCH', 'The uploaded file size does not match. Please try again.', HttpStatus.UNPROCESSABLE_ENTITY, {
        expected: Number(media.declaredSizeBytes),
        actual: head?.sizeBytes ?? null,
      });
    }

    const updated = await this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'UPLOADED', sizeBytes: BigInt(head.sizeBytes), uploadedAt: new Date(), multipartUploadId: null },
    });
    await this.jobs.send(QUEUES.mediaProbe, { mediaId: media.id }, { singletonKey: `probe:${media.id}` });
    return toMediaResponse(updated);
  }

  async get(userId: string, mediaId: string): Promise<MediaResponse> {
    return toMediaResponse(await this.owned(userId, mediaId));
  }

  async remove(userId: string, mediaId: string): Promise<void> {
    const media = await this.owned(userId, mediaId);
    const active = await this.prisma.publication.count({
      where: { post: { mediaId }, status: { notIn: ['PUBLISHED', 'FAILED_FINAL', 'CANCELLED'] } },
    });
    if (active > 0) throw actionNotAllowed('This video is still being published.');
    if (media.multipartUploadId) await this.storage.abortMultipartUpload(media.storageKey, media.multipartUploadId);
    const variants = await this.prisma.mediaVariant.findMany({ where: { mediaId } });
    await this.storage.deleteObjects([media.storageKey, ...variants.map((v) => v.storageKey)]).catch(() => undefined);
    await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'DELETED', deletedAt: new Date(), multipartUploadId: null } });
  }

  private async owned(userId: string, mediaId: string): Promise<Media> {
    const media = await this.prisma.media.findFirst({ where: { id: mediaId, userId } });
    if (!media) throw notFound('Video');
    return media;
  }

  private async assertCanPublishSomewhere(userId: string): Promise<void> {
    const { decisions } = await this.entitlements.resolveAll(userId);
    const allowed = [...decisions.values()].some((d) => d.capability.endsWith('.publish') && d.allowed);
    if (!allowed) throw new AppError('CAPABILITY_DENIED', "Publishing isn't available on your account right now.", HttpStatus.FORBIDDEN);
  }
}
