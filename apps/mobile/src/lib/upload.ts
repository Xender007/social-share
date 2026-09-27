import type { MediaResponse, UploadPartUrl } from '@sp/contracts';
import { fetch as expoFetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { api, ApiError } from './api';

export interface UploadCheckpoint {
  mediaId: string;
  partSizeBytes: number;
  partCount: number;
  sizeBytes: number;
  localUri: string;
  completed: Array<{ partNumber: number; etag: string }>;
}

export interface UploadCallbacks {
  onProgress(fraction: number): void;
  onCheckpoint(checkpoint: UploadCheckpoint): void;
}

const MAX_PART_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shared/picked content:// URIs can be temporary: copy into the app cache first (§25.3). */
export async function toLocalFile(uri: string, fileName: string): Promise<File> {
  if (uri.startsWith('file://')) return new File(uri);
  const safe = fileName.replace(/[^\w.-]+/g, '_').slice(-80) || 'video.mp4';
  const target = new File(Paths.cache, `upload-${Date.now()}-${safe}`);
  await new File(uri).copy(target);
  return target;
}

async function putPart(url: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  // expo/fetch sends typed arrays as raw bytes.
  const res = await expoFetch(url, { method: 'PUT', body: bytes as unknown as ArrayBuffer, signal });
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_PART_FAILED', `Upload part failed (${res.status})`);
  const etag = res.headers.get('etag');
  if (!etag) throw new ApiError(0, 'UPLOAD_NO_ETAG', 'Storage did not return an ETag');
  return etag;
}

/**
 * Resumable multipart upload straight to object storage (§15.2).
 * Completed parts are reported through onCheckpoint so an interrupted upload resumes without re-sending them.
 */
export async function uploadVideo(
  input: { uri: string; fileName: string; mimeType: string },
  callbacks: UploadCallbacks,
  resume?: UploadCheckpoint | null,
  signal?: AbortSignal,
): Promise<MediaResponse> {
  const file = resume ? new File(resume.localUri) : await toLocalFile(input.uri, input.fileName);
  const sizeBytes = file.size;
  if (!sizeBytes) throw new ApiError(0, 'EMPTY_FILE', 'This video file is empty or could not be read.');

  let checkpoint: UploadCheckpoint;
  let urls = new Map<number, string>();
  let urlsExpireAt = 0;

  if (resume && resume.sizeBytes === sizeBytes) {
    checkpoint = resume;
  } else {
    const started = await api.startUpload({ filename: input.fileName, mimeType: input.mimeType || 'video/mp4', sizeBytes });
    checkpoint = { mediaId: started.mediaId, partSizeBytes: started.partSizeBytes, partCount: started.partCount, sizeBytes, localUri: file.uri, completed: [] };
    urls = new Map(started.parts.map((p: UploadPartUrl) => [p.partNumber, p.url]));
    urlsExpireAt = Date.parse(started.expiresAt);
    callbacks.onCheckpoint(checkpoint);
  }

  const done = new Set(checkpoint.completed.map((p) => p.partNumber));
  callbacks.onProgress(done.size / checkpoint.partCount);
  const handle = file.open();
  try {
    for (let partNumber = 1; partNumber <= checkpoint.partCount; partNumber++) {
      if (done.has(partNumber)) continue;
      if (signal?.aborted) throw new ApiError(0, 'UPLOAD_CANCELLED', 'Upload cancelled.');

      if (!urls.has(partNumber) || Date.now() > urlsExpireAt - 60_000) {
        const remaining = Array.from({ length: checkpoint.partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
        const fresh = await api.uploadParts(checkpoint.mediaId, remaining);
        urls = new Map(fresh.parts.map((p) => [p.partNumber, p.url]));
        urlsExpireAt = Date.parse(fresh.expiresAt);
      }

      const offset = (partNumber - 1) * checkpoint.partSizeBytes;
      handle.offset = offset;
      const bytes = handle.readBytes(Math.min(checkpoint.partSizeBytes, sizeBytes - offset));

      let etag: string | null = null;
      for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && !etag; attempt++) {
        try {
          etag = await putPart(urls.get(partNumber)!, bytes, signal);
        } catch (error) {
          if (attempt === MAX_PART_ATTEMPTS || signal?.aborted) throw error;
          await sleep(1000 * 2 ** (attempt - 1));
          if (error instanceof ApiError && error.status === 403) urlsExpireAt = 0;
        }
      }
      checkpoint = { ...checkpoint, completed: [...checkpoint.completed, { partNumber, etag: etag! }] };
      done.add(partNumber);
      callbacks.onCheckpoint(checkpoint);
      callbacks.onProgress(done.size / checkpoint.partCount);
    }
  } finally {
    handle.close();
  }

  return api.completeUpload(checkpoint.mediaId, { parts: checkpoint.completed });
}
