import type { PublicationStatus } from '@sp/contracts';
import { PublicationRepository } from './publication.repository';

/**
 * `PublicationRepository.transition()` is the single place that performs `prisma.publication.update(...)`
 * for a status change (via `updateMany` + optimistic locking), then recomputes the post rollup in the same
 * transaction. These tests cover the auto-media-cleanup trigger it surfaces on `events.mediaCleanup`:
 * it fires only when every publication for the post is PUBLISHED or CANCELLED. A FAILED_FINAL publication
 * keeps the video (the user can still press Retry); the daily cleanup cron removes it later.
 */

function makePub(overrides: Partial<{ id: string; postId: string; status: PublicationStatus; version: number }> = {}) {
  return {
    id: 'pub-1',
    postId: 'post-1',
    status: 'IN_PROGRESS' as PublicationStatus,
    version: 1,
    checkpoint: {},
    post: { id: 'post-1', userId: 'u1', mediaId: 'media-1' },
    platform: { code: 'youtube', name: 'YouTube' },
    ...overrides,
  } as never;
}

function makeRepo(publications: Array<{ status: PublicationStatus }>, postOverrides: Partial<{ status: string; notifiedAt: Date | null; mediaId: string; userId: string }> = {}) {
  const postRow = {
    id: 'post-1',
    userId: postOverrides.userId ?? 'u1',
    mediaId: postOverrides.mediaId ?? 'media-1',
    status: postOverrides.status ?? 'PUBLISHING',
    notifiedAt: postOverrides.notifiedAt ?? null,
    publications,
  };
  const tx = {
    publication: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      findUniqueOrThrow: vi.fn().mockResolvedValue(makePub({ status: 'PUBLISHED' })),
    },
    post: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(postRow),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
  const prisma = { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  const repo = new PublicationRepository(prisma as never);
  return { repo, tx, prisma };
}

describe('PublicationRepository.transition — auto media cleanup trigger', () => {
  it('fires mediaCleanup once the last of 3 publications is PUBLISHED', async () => {
    const { repo } = makeRepo([{ status: 'PUBLISHED' }, { status: 'PUBLISHED' }, { status: 'PUBLISHED' }]);
    const pub = makePub({ status: 'IN_PROGRESS' });

    const { events } = await repo.transition(pub, 'PUBLISHED', {});

    expect(events.mediaCleanup).toEqual({ mediaId: 'media-1', postId: 'post-1' });
  });

  it('keeps the video when a publication is FAILED_FINAL, so Retry still works', async () => {
    const { repo } = makeRepo([{ status: 'PUBLISHED' }, { status: 'FAILED_FINAL' }, { status: 'PUBLISHED' }]);
    const pub = makePub({ status: 'IN_PROGRESS' });

    const { events } = await repo.transition(pub, 'PUBLISHED', {});

    expect(events.mediaCleanup).toBeUndefined();
  });

  it('does not fire mediaCleanup while one of the 3 publications is still QUEUED', async () => {
    const { repo } = makeRepo([{ status: 'PUBLISHED' }, { status: 'FAILED_FINAL' }, { status: 'QUEUED' }]);
    const pub = makePub({ status: 'IN_PROGRESS' });

    const { events } = await repo.transition(pub, 'PUBLISHED', {});

    expect(events.mediaCleanup).toBeUndefined();
  });

  it('still fires mediaCleanup when every publication ends up CANCELLED (no notification, but cleanup still applies)', async () => {
    const { repo } = makeRepo([{ status: 'CANCELLED' }, { status: 'CANCELLED' }]);
    const pub = makePub({ id: 'pub-2', status: 'QUEUED' });

    const { events } = await repo.transition(pub, 'CANCELLED', {});

    expect(events.mediaCleanup).toEqual({ mediaId: 'media-1', postId: 'post-1' });
    expect(events.postBecameTerminal).toBeUndefined();
  });
});
