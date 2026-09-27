import { MediaService } from './media.service';

/**
 * `cleanupCompletedPost` is the auto-delete path invoked once every publication for a post has reached a
 * terminal status. It reuses the same "still active?" check and delete steps as the manual `remove()`
 * endpoint (`deleteIfNotActive`), just without throwing when something is still active.
 */
function makeService(overrides: { media?: Record<string, unknown> | null; activeCount?: number } = {}) {
  const media = overrides.media === null ? null : { id: 'media-1', status: 'READY', multipartUploadId: null, storageKey: 'media/u1/media-1/original.mp4', ...overrides.media };

  const prisma = {
    media: {
      findUnique: vi.fn().mockResolvedValue(media),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...media, ...data })),
    },
    publication: {
      count: vi.fn().mockResolvedValue(overrides.activeCount ?? 0),
    },
    mediaVariant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const storage = {
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MediaService(prisma as never, storage as never, undefined as never, undefined as never, undefined as never);
  return { service, prisma, storage };
}

describe('MediaService.cleanupCompletedPost', () => {
  it('deletes the media once every publication for the post is terminal (active count 0)', async () => {
    const { service, prisma, storage } = makeService({ activeCount: 0 });

    await service.cleanupCompletedPost('media-1', 'post-1');

    expect(storage.deleteObjects).toHaveBeenCalledWith(['media/u1/media-1/original.mp4']);
    expect(prisma.media.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: { status: 'DELETED', deletedAt: expect.any(Date), multipartUploadId: null },
    });
  });

  it('does not delete the media while a publication still needs it (e.g. QUEUED or FAILED_FINAL awaiting Retry)', async () => {
    const { service, prisma, storage } = makeService({ activeCount: 1 });

    await service.cleanupCompletedPost('media-1', 'post-1');

    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(prisma.media.update).not.toHaveBeenCalled();
  });

  it('is idempotent: calling it twice does not error or delete twice', async () => {
    const { service, prisma, storage } = makeService({ activeCount: 0 });

    await service.cleanupCompletedPost('media-1', 'post-1');
    // Second call sees the media already marked DELETED, as it would be for real after the first call's update.
    prisma.media.findUnique.mockResolvedValueOnce({ id: 'media-1', status: 'DELETED' });

    await expect(service.cleanupCompletedPost('media-1', 'post-1')).resolves.toBeUndefined();

    expect(storage.deleteObjects).toHaveBeenCalledTimes(1);
    expect(prisma.media.update).toHaveBeenCalledTimes(1);
  });

  it('skips silently when the media was already DELETED', async () => {
    const { service, prisma, storage } = makeService({ media: { status: 'DELETED' } });

    await service.cleanupCompletedPost('media-1', 'post-1');

    expect(prisma.publication.count).not.toHaveBeenCalled();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });
});
