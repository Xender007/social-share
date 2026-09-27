import { empty, json, makeContext, mockFetch } from '../__test__/context';
import { ProviderError } from '../types';
import { YouTubePublisher } from './youtube.publisher';

const MiB = 1024 * 1024;
const publisher = new YouTubePublisher();
const options = { privacyStatus: 'private', madeForKids: false, categoryId: '22' };

afterEach(() => vi.unstubAllGlobals());

describe('YouTubePublisher (contract)', () => {
  it('INIT_SESSION sends metadata and stores the resumable session URI', async () => {
    const calls = mockFetch(() => empty(200, { location: 'https://upload.youtube.test/session-1' }));
    const result = await publisher.runStep('INIT_SESSION', makeContext({ options }));

    expect(result).toEqual({ kind: 'advance', nextStep: 'UPLOAD_BYTES', checkpoint: { sessionUri: 'https://upload.youtube.test/session-1', videoId: undefined } });
    expect(calls[0].url).toContain('uploadType=resumable');
    expect(calls[0].headers.authorization).toBe('Bearer user-token');
    expect(calls[0].headers['x-upload-content-length']).toBe(String(20 * MiB));
    const body = JSON.parse(calls[0].body!);
    expect(body.snippet.title).toBe('Sunset');
    expect(body.status).toMatchObject({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
  });

  it('UPLOAD_BYTES resumes from the byte YouTube already has and never re-sends confirmed data', async () => {
    const puts: string[] = [];
    mockFetch((call) => {
      const range = call.headers['content-range'];
      if (range === `bytes */${20 * MiB}`) return empty(308, { range: `bytes=0-${8 * MiB - 1}` });
      puts.push(range);
      if (range.startsWith(`bytes ${8 * MiB}-`)) return empty(308, { range: `bytes=0-${16 * MiB - 1}` });
      return json({ id: 'vid123' }, 201);
    });
    const ctx = makeContext({ options, checkpoint: { sessionUri: 'https://upload.youtube.test/session-1' } });
    const result = await publisher.runStep('UPLOAD_BYTES', ctx);

    expect(result).toMatchObject({ kind: 'advance', nextStep: 'WAIT_PROCESSING', checkpoint: { videoId: 'vid123' } });
    expect(puts).toEqual([`bytes ${8 * MiB}-${16 * MiB - 1}/${20 * MiB}`, `bytes ${16 * MiB}-${20 * MiB - 1}/${20 * MiB}`]);
    expect(ctx.readRanges[0][0]).toBe(8 * MiB);
  });

  it('an expired session is recreated instead of failing', async () => {
    let inits = 0;
    mockFetch((call) => {
      if (call.method === 'POST') {
        inits += 1;
        return empty(200, { location: 'https://upload.youtube.test/session-2' });
      }
      if (call.headers['content-range']?.startsWith('bytes */')) return empty(404);
      return json({ id: 'vid-new' }, 200);
    });
    const result = await publisher.runStep('UPLOAD_BYTES', makeContext({ options, sizeBytes: 5 * MiB, checkpoint: { sessionUri: 'https://upload.youtube.test/old' } }));
    expect(inits).toBe(1);
    expect(result).toMatchObject({ checkpoint: { sessionUri: 'https://upload.youtube.test/session-2', videoId: 'vid-new' } });
  });

  it('maps quotaExceeded to RATE_LIMITED with a retry after the quota reset', async () => {
    mockFetch(() => json({ error: { code: 403, message: 'Quota exceeded', errors: [{ reason: 'quotaExceeded' }] } }, 403));
    const error = await publisher.runStep('INIT_SESSION', makeContext({ options })).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.classified).toMatchObject({ category: 'RATE_LIMITED', code: 'YT_QUOTA_EXCEEDED', requestHadNoEffect: true });
    expect(error.classified.retryAfterMs).toBeGreaterThan(0);
  });

  it('maps 401 to AUTH', async () => {
    mockFetch(() => json({ error: { code: 401, message: 'Invalid Credentials' } }, 401));
    const error = await publisher.runStep('INIT_SESSION', makeContext({ options })).catch((e) => e);
    expect(error.classified).toMatchObject({ category: 'AUTH', code: 'YT_REAUTH' });
  });

  it('WAIT_PROCESSING waits, then finishes with a Shorts URL for a vertical clip under 3 minutes', async () => {
    let polls = 0;
    mockFetch(() => {
      polls += 1;
      return json({ items: [{ id: 'vid123', status: { uploadStatus: polls === 1 ? 'uploaded' : 'processed' }, processingDetails: { processingStatus: polls === 1 ? 'processing' : 'succeeded' } }] });
    });
    const ctx = makeContext({ options, checkpoint: { videoId: 'vid123' } });
    expect(await publisher.runStep('WAIT_PROCESSING', ctx)).toMatchObject({ kind: 'wait' });
    expect(await publisher.runStep('WAIT_PROCESSING', ctx)).toEqual({ kind: 'done', externalId: 'vid123', externalUrl: 'https://www.youtube.com/shorts/vid123' });
  });

  it('a rejected upload becomes MEDIA_INVALID with the reason', async () => {
    mockFetch(() => json({ items: [{ id: 'vid123', status: { uploadStatus: 'rejected', rejectionReason: 'duplicate' } }] }));
    const error = await publisher.runStep('WAIT_PROCESSING', makeContext({ options, checkpoint: { videoId: 'vid123' } })).catch((e) => e);
    expect(error.classified).toMatchObject({ category: 'MEDIA_INVALID', providerCode: 'duplicate' });
  });

  describe('reconcile', () => {
    it('a session that already completed means the video exists: wait for processing, do not upload again', async () => {
      mockFetch(() => json({ id: 'vid-done' }, 200));
      const result = await publisher.reconcile(makeContext({ options, checkpoint: { sessionUri: 'https://upload.youtube.test/s' } }));
      expect(result).toEqual({ kind: 'in_progress', step: 'WAIT_PROCESSING', checkpoint: { videoId: 'vid-done' } });
    });

    it('an incomplete session resumes the upload', async () => {
      mockFetch(() => empty(308, { range: 'bytes=0-1000' }));
      expect(await publisher.reconcile(makeContext({ options, checkpoint: { sessionUri: 'https://upload.youtube.test/s' } }))).toEqual({ kind: 'not_published', resumeFromStep: 'UPLOAD_BYTES' });
    });

    it('a processed video is published', async () => {
      mockFetch(() => json({ items: [{ id: 'vid123', status: { uploadStatus: 'processed' } }] }));
      expect(await publisher.reconcile(makeContext({ options, checkpoint: { videoId: 'vid123' } }))).toMatchObject({ kind: 'published', externalId: 'vid123' });
    });
  });
});
