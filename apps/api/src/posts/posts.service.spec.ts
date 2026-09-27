import { PostsService } from './posts.service';

const meta = { requestId: 'req-1', ip: '127.0.0.1' };
const body = { mediaId: 'media-1', destinations: [] as never[] };

/**
 * `PostsService.create()` caps a user at 15 posts that still have at least one publication in an
 * "active" (not-yet-finished) status — `['PENDING_MEDIA', 'QUEUED', 'RETRY_SCHEDULED', 'PAUSED',
 * 'NEEDS_USER_ACTION']` — before it will create a new one. These tests exercise just that gate: the
 * idempotency check runs first (no existing post with this key), then the cap check runs before any
 * media/account/entitlement work, so a distinct error past that point (video not found) is enough to prove
 * the cap check let the request through without needing to mock the rest of the create pipeline.
 */
function makeService(activePostCount: number) {
  const prisma = {
    post: {
      findUnique: vi.fn().mockResolvedValue(null), // no existing post for this idempotency key
      count: vi.fn().mockResolvedValue(activePostCount),
    },
    media: {
      findFirst: vi.fn().mockResolvedValue(null), // forces NOT_FOUND once past the cap check
    },
  };
  const service = new PostsService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return { service, prisma };
}

describe('PostsService.create — active post cap', () => {
  it('rejects a 16th active post when 15 are already in progress', async () => {
    const { service, prisma } = makeService(15);

    await expect(service.create('u1', 'idem-key-1234', body, meta)).rejects.toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
      status: 409,
      message: 'You already have 15 posts in progress. Wait for one to finish or cancel one before creating another.',
    });

    expect(prisma.post.count).toHaveBeenCalledWith({
      where: { userId: 'u1', publications: { some: { status: { in: ['PENDING_MEDIA', 'QUEUED', 'RETRY_SCHEDULED', 'PAUSED', 'NEEDS_USER_ACTION'] } } } },
    });
    // Never got as far as looking up the media, since the cap rejected it first.
    expect(prisma.media.findFirst).not.toHaveBeenCalled();
  });

  it('lets the request through when only 14 posts are active (terminal ones do not count)', async () => {
    const { service, prisma } = makeService(14);

    // Past the cap check, it proceeds to look up the media and fails there instead — proving the cap did not block it.
    await expect(service.create('u1', 'idem-key-1234', body, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.media.findFirst).toHaveBeenCalled();
  });
});
