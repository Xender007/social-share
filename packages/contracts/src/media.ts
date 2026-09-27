import { z } from 'zod';
import type { MediaStatus } from './enums';

export const startUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/i, 'Only video files can be uploaded'),
  sizeBytes: z.number().int().positive(),
});
export type StartUploadRequest = z.infer<typeof startUploadSchema>;

export interface UploadPartUrl {
  partNumber: number;
  url: string;
}

export interface StartUploadResponse {
  mediaId: string;
  uploadId: string;
  partSizeBytes: number;
  partCount: number;
  parts: UploadPartUrl[];
  expiresAt: string;
}

export const uploadPartsQuerySchema = z.object({
  parts: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((s) => s.split(',').map(Number)),
});

export const completeUploadSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10000),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadSchema>;

export interface MediaResponse {
  id: string;
  status: MediaStatus;
  originalFilename: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  isHdr: boolean | null;
  invalidReason: string | null;
  createdAt: string;
}
