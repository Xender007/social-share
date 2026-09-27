import { json, makeContext, mockFetch } from '../__test__/context';
import { FacebookPublisher } from './facebook.publisher';

const publisher = new FacebookPublisher();
afterEach(() => vi.unstubAllGlobals());

describe('FacebookPublisher (contract)', () => {
  it('runs start -> transfer -> finish with the Page token and hosted file URL', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/video_reels') && call.body?.includes('upload_phase=start')) return json({ video_id: 'v-1', upload_url: 'https://rupload.facebook.test/v-1' });
      if (call.url.startsWith('https://rupload')) return json({ success: true });
      return json({ success: true });
    });

    const start = await publisher.runStep('START_UPLOAD', makeContext());
    expect(start).toEqual({ kind: 'advance', nextStep: 'TRANSFER', checkpoint: { videoId: 'v-1', uploadUrl: 'https://rupload.facebook.test/v-1', finishSent: false } });

    const transfer = await publisher.runStep('TRANSFER', makeContext({ checkpoint: { videoId: 'v-1', uploadUrl: 'https://rupload.facebook.test/v-1' } }));
    expect(transfer).toEqual({ kind: 'advance', nextStep: 'WAIT_UPLOAD' });
    expect(calls[1].headers.authorization).toBe('OAuth page-token');
    expect(calls[1].headers.file_url).toContain('X-Amz-Signature');

    const finish = await publisher.runStep('FINISH', makeContext({ checkpoint: { videoId: 'v-1' } }));
    expect(finish).toEqual({ kind: 'advance', nextStep: 'WAIT_PUBLISH', checkpoint: { finishSent: true } });
    const form = new URLSearchParams(calls[2].body!);
    expect(form.get('upload_phase')).toBe('finish');
    expect(form.get('video_state')).toBe('PUBLISHED');
    expect(form.get('description')).toBe('Golden hour #sunset');
  });

  it('FINISH is the only non-idempotent step', () => {
    expect([...publisher.nonIdempotentSteps]).toEqual(['FINISH']);
  });

  it('waits for publishing and returns the permalink', async () => {
    const phases = ['in_progress', 'complete'];
    mockFetch(() => json({ status: { video_status: 'processing', publishing_phase: { status: phases.shift() } }, permalink_url: '/reel/123' }));
    const ctx = makeContext({ checkpoint: { videoId: 'v-1' } });
    expect(await publisher.runStep('WAIT_PUBLISH', ctx)).toMatchObject({ kind: 'wait' });
    expect(await publisher.runStep('WAIT_PUBLISH', ctx)).toEqual({ kind: 'done', externalId: 'v-1', externalUrl: 'https://www.facebook.com/reel/123' });
  });

  it('a processing error is reported as a media problem with the provider message', async () => {
    mockFetch(() => json({ status: { processing_phase: { status: 'error', errors: [{ code: 1363040, message: 'Aspect ratio not supported' }] } } }));
    const error = await publisher.runStep('WAIT_PUBLISH', makeContext({ checkpoint: { videoId: 'v-1' } })).catch((e) => e);
    expect(error.classified).toMatchObject({ category: 'MEDIA_INVALID', code: 'FB_PROCESSING_ERROR' });
    expect(error.classified.userMessage).toContain('Aspect ratio');
  });

  it('missing Page token asks the user to reconnect', async () => {
    mockFetch(() => json({}));
    const error = await publisher.runStep('START_UPLOAD', makeContext({ credentials: { accessToken: 'user-token' } })).catch((e) => e);
    expect(error.classified).toMatchObject({ category: 'AUTH', code: 'FB_PAGE_TOKEN_MISSING' });
  });

  describe('reconcile', () => {
    it('published video = published (no second FINISH)', async () => {
      mockFetch(() => json({ published: true, status: { publishing_phase: { status: 'complete' } }, permalink_url: 'https://www.facebook.com/reel/9' }));
      expect(await publisher.reconcile(makeContext({ checkpoint: { videoId: 'v-1' } }))).toEqual({ kind: 'published', externalId: 'v-1', externalUrl: 'https://www.facebook.com/reel/9' });
    });

    it('uploaded but not finished resumes at FINISH', async () => {
      mockFetch(() => json({ status: { uploading_phase: { status: 'complete' }, publishing_phase: { status: 'not_started' } } }));
      expect(await publisher.reconcile(makeContext({ checkpoint: { videoId: 'v-1' } }))).toEqual({ kind: 'not_published', resumeFromStep: 'FINISH' });
    });

    it('nothing started yet restarts from the beginning', async () => {
      expect(await publisher.reconcile(makeContext())).toEqual({ kind: 'not_published', resumeFromStep: 'START_UPLOAD' });
    });
  });
});
