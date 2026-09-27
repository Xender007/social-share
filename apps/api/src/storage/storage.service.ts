import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import type { UploadPartUrl } from '@sp/contracts';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppConfig } from '../config/app-config';

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

/** S3-compatible object storage: Cloudflare R2 in production, SeaweedFS locally. */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  /** Used by the API/worker itself. */
  private readonly internal: S3Client;
  /** Used only to presign URLs that the phone or a provider will call. */
  private readonly publicSigner: S3Client;
  readonly bucket: string;

  constructor(private readonly config: AppConfig) {
    const env = config.env;
    const common = {
      region: env.STORAGE_REGION,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...common, endpoint: env.STORAGE_ENDPOINT });
    this.publicSigner = new S3Client({ ...common, endpoint: env.STORAGE_PUBLIC_ENDPOINT });
    this.bucket = env.STORAGE_BUCKET;
  }

  async onModuleInit(): Promise<void> {
    if (this.config.env.NODE_ENV === 'production') return;
    try {
      await this.ensureBucket();
    } catch (error) {
      this.logger.warn(`Storage bucket check failed (is "pnpm infra" running?): ${(error as Error).message}`);
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.internal.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket ${this.bucket}`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.internal.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!result.UploadId) throw new Error('Storage did not return an upload id');
    return result.UploadId;
  }

  async presignUploadParts(key: string, uploadId: string, partNumbers: number[], ttlSeconds: number): Promise<UploadPartUrl[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.publicSigner,
          new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
          { expiresIn: ttlSeconds },
        ),
      })),
    );
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    await this.internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"` })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.internal.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => undefined);
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(result.ContentLength ?? 0), contentType: result.ContentType ?? null };
    } catch {
      return null;
    }
  }

  /** Short-lived GET URL. `audience: 'internal'` for ffprobe/ffmpeg on this machine, `'public'` for providers and the phone. */
  signedGetUrl(key: string, ttlSeconds: number, audience: 'internal' | 'public' = 'internal'): Promise<string> {
    const client = audience === 'public' ? this.publicSigner : this.internal;
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async openRange(key: string, start: number, endInclusive: number): Promise<Readable> {
    const result = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${endInclusive}` }));
    return result.Body as Readable;
  }

  async downloadToFile(key: string, filePath: string): Promise<void> {
    const result = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await pipeline(result.Body as Readable, createWriteStream(filePath));
  }

  async uploadFile(key: string, filePath: string, contentType: string): Promise<number> {
    const { size } = await stat(filePath);
    await this.internal.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: contentType }),
    );
    return size;
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.internal.send(
      new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
    );
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
