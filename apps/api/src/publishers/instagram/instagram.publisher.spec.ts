import { json, makeContext, mockFetch } from '../__test__/context';
import { InstagramPublisher } from './instagram.publisher';

const publisher = new InstagramPublisher();
afterEach(() => vi.unstubAllGlobals());

describe('InstagramPublisher (contract)', () => {
  it('CHECK_LIMIT stops before creating anything when the daily cap is reached', async () => {
    mockFetch(() => json({ data: [{ quota_usage: 50, config: { quota_total: 50, quota_duration: 86400 } }] }));
    const error = await publisher.runStep('CHECK_LIMIT', makeContext()).catch((e) => e);
    expect(error.classified).toMatchObject({ category: 'PROVIDER_LIMIT', code: 'IG_PUBLISH_LIMIT', requestHadNoEffect: true });
  });

  it('CREATE_CONTAINER sends a REELS container with the signed video URL and the Page token', async () => {
    const calls = mockFetch(() => json({ id: 'container-9' }));
    const result = await publisher.runStep('CREATE_CONTAINER', makeContext({ options: { shareToFeed: true, coverFrameMs: 1500 } }));
    expect(result).toEqual({ kind: 'advance', nextStep: 'WAIT_CONTAINER', checkpoint: { containerId: 'container-9', mediaId: null } });
    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/ext-account-1/media');
    const form = new URLSearchParams(calls[0].body!);
    expect(form.get('media_type')).toBe('REELS');
    expect(form.get('video_url')).toContain('X-Amz-Signature');
    expect(form.get('share_to_feed')).toBe('true');
    expect(form.get('thumb_offset')).toBe('1500');
    expect(form.get('access_token')).toBe('page-token');
  });

  it('WAIT_CONTAINER: processing waits, ERROR is a media problem, EXPIRED recreates the container', async () => {
    const statuses = ['IN_PROGRESS', 'ERROR', 'EXPIRED'];
    mockFetch(() => json({ status_code: statuses.shift(), status: 'Error: unsupported codec' }));
    const ctx = makeContext({ checkpoint: { containerId: 'container-9' } });
    expect(await publisher.runStep('WAIT_CONTAINER', ctx)).toMatchObject({ kind: 'wait', pollAfterMs: 60_000 });
    const error = await publisher.runStep('WAIT_CONTAINER', ctx).catch((e) => e);
    expect(error.classified).toMatchObject({ category: 'MEDIA_INVALID', code: 'IG_CONTAINER_ERROR' });
    expect(await publisher.runStep('WAIT_CONTAINER', ctx)).toEqual({ kind: 'advance', nextStep: 'CREATE_CONTAINER', checkpoint: { containerId: null } });
  });

  it('PUBLISH_CONTAINER then FETCH_PERMALINK finishes with the real permalink', async () => {
    mockFetch((call) => (call.url.includes('media_publish') ? json({ id: 'media-77' }) : json({ id: 'media-77', permalink: 'https://www.instagram.com/reel/abc/' })));
    const published = await publisher.runStep('PUBLISH_CONTAINER', makeContext({ checkpoint: { containerId: 'container-9' } }));
    expect(published).toEqual({ kind: 'advance', nextStep: 'FETCH_PERMALINK', checkpoint: { mediaId: 'media-77' } });
    const done = await publisher.runStep('FETCH_PERMALINK', makeContext({ checkpoint: { containerId: 'container-9', mediaId: 'media-77' } }));
    expect(done).toEqual({ kind: 'done', externalId: 'media-77', externalUrl: 'https://www.instagram.com/reel/abc/' });
  });

  it('maps Graph error 190 to AUTH and throttling codes to RATE_LIMITED', async () => {
    mockFetch(() => json({ error: { message: 'Session expired', code: 190 } }, 400));
    expect((await publisher.runStep('CREATE_CONTAINER', makeContext()).catch((e) => e)).classified.category).toBe('AUTH');
    vi.unstubAllGlobals();
    mockFetch(() => json({ error: { message: 'Application request limit reached', code: 4 } }, 400));
    expect((await publisher.runStep('CREATE_CONTAINER', makeContext()).catch((e) => e)).classified).toMatchObject({ category: 'RATE_LIMITED', code: 'META_THROTTLED' });
  });

  describe('reconcile (duplicate protection)', () => {
    const startedAt = new Date('2026-09-15T10:00:00Z');

    it('container already PUBLISHED + exactly one matching post = published, never re-published', async () => {
      mockFetch((call) =>
        call.url.includes('/media?')
          ? json({ data: [{ id: 'media-77', caption: 'Golden hour #sunset', timestamp: '2026-09-15T10:00:30+0000', permalink: 'https://www.instagram.com/reel/abc/' }, { id: 'old', caption: 'Other', timestamp: '2026-09-14T10:00:00+0000' }] })
          : json({ status_code: 'PUBLISHED' }),
      );
      const result = await publisher.reconcile(makeContext({ checkpoint: { containerId: 'container-9' }, inFlightStartedAt: startedAt }));
      expect(result).toMatchObject({ kind: 'published', externalId: 'media-77' });
    });

    it('ambiguous matches are left to the user', async () => {
      mockFetch((call) =>
        call.url.includes('/media?')
          ? json({ data: [{ id: 'a', caption: 'Golden hour #sunset', timestamp: '2026-09-15T10:00:30+0000' }, { id: 'b', caption: 'Golden hour #sunset', timestamp: '2026-09-15T10:01:00+0000' }] })
          : json({ status_code: 'PUBLISHED' }),
      );
      expect((await publisher.reconcile(makeContext({ checkpoint: { containerId: 'container-9' }, inFlightStartedAt: startedAt }))).kind).toBe('undeterminable');
    });

    it('a FINISHED container was not published yet: resume at publish', async () => {
      mockFetch(() => json({ status_code: 'FINISHED' }));
      expect(await publisher.reconcile(makeContext({ checkpoint: { containerId: 'container-9' } }))).toEqual({ kind: 'not_published', resumeFromStep: 'PUBLISH_CONTAINER' });
    });
  });
});
