import { Readable } from 'node:stream';
import type { ProbeResult } from '../../media-processing/rules';
import type { PublishContext } from '../types';

export const verticalProbe: ProbeResult = {
  container: 'mp4',
  formatNames: ['mov', 'mp4'],
  videoCodec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
  width: 1080,
  height: 1920,
  rotation: 0,
  durationMs: 21_000,
  frameRate: 30,
  isVariableFrameRate: false,
  isHdr: false,
  bitDepth: 8,
  sizeBytes: 20 * 1024 * 1024,
};

type ContextOverrides = {
  checkpoint?: Record<string, unknown>;
  options?: Record<string, unknown>;
  text?: PublishContext['text'];
  sizeBytes?: number;
  inFlightStartedAt?: Date | null;
  credentials?: { accessToken: string; destinationToken?: string };
};

/** A PublishContext with in-memory media and fixed credentials for adapter contract tests. */
export function makeContext(overrides: ContextOverrides = {}): PublishContext & { readRanges: Array<[number, number]> } {
  const readRanges: Array<[number, number]> = [];
  const sizeBytes = overrides.sizeBytes ?? verticalProbe.sizeBytes!;
  return {
    readRanges,
    publication: { id: 'pub-1', attemptCount: 0, pollCount: 0, waitingSince: null, inFlightStartedAt: overrides.inFlightStartedAt ?? null },
    checkpoint: overrides.checkpoint ?? {},
    account: { id: 'acc-1', externalAccountId: 'ext-account-1', displayName: 'Demo', metadata: {} },
    credentials: async () => overrides.credentials ?? { accessToken: 'user-token', destinationToken: 'page-token' },
    media: {
      probe: { ...verticalProbe, sizeBytes },
      sizeBytes,
      contentType: 'video/mp4',
      signedUrl: async () => 'https://storage.example.com/media/video.mp4?X-Amz-Signature=abc',
      openRange: async (start, end) => {
        readRanges.push([start, end]);
        return Readable.from([Buffer.alloc(end - start + 1)]);
      },
    },
    text: overrides.text ?? { title: 'Sunset', caption: 'Golden hour #sunset' },
    options: overrides.options ?? {},
    config: { apiVersion: 'v23.0', apiBaseUrl: 'http://localhost:3000' },
    signal: new AbortController().signal,
  };
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Replaces global fetch with a scripted handler and records every request. */
export function mockFetch(handler: (call: RecordedCall) => Response | Promise<Response>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null;
      const call = { url: String(input), method: init.method ?? 'GET', headers, body };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const empty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });
