import { Injectable } from '@nestjs/common';
import type { PostStatus, PublicationStatus } from '@sp/contracts';
import { toJsonValue } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { assertTransition, isTerminal, rollupPostStatus } from './state-machine';

export const publicationInclude = {
  post: true,
  platform: true,
  mediaVariant: true,
  socialAccount: { include: { connection: true } },
} satisfies Prisma.PublicationInclude;

export type PublicationRow = Prisma.PublicationGetPayload<{ include: typeof publicationInclude }>;

/** Runner-owned keys in publications.checkpoint; adapters get their own namespace under the platform code. */
export interface RunnerCheckpoint {
  inFlight?: { step: string; startedAt: string } | null;
  pollCount?: number;
  hadUnknownOutcome?: boolean;
  reconcileAttempts?: number;
  [namespace: string]: unknown;
}

export class ConcurrentModificationError extends Error {
  constructor(id: string) {
    super(`Publication ${id} was modified concurrently`);
  }
}

export type PublicationPatch = Omit<Prisma.PublicationUpdateManyMutationInput, 'status' | 'version' | 'checkpoint'> & {
  checkpoint?: RunnerCheckpoint;
  /** Relation scalar: applied with a separate update inside the same transaction. */
  mediaVariantId?: string | null;
};

export interface TransitionEvents {
  postBecameTerminal?: { postId: string; userId: string; status: PostStatus };
  needsAction?: boolean;
  /**
   * Every publication for this post is PUBLISHED or CANCELLED, so its video will never be needed again.
   * FAILED_FINAL is deliberately excluded: the user can still press Retry, which needs the video. Those are
   * left for the daily media cleanup cron, which deletes terminal media after `media_retention_days`.
   */
  mediaCleanup?: { mediaId: string; postId: string };
}

@Injectable()
export class PublicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  load(id: string): Promise<PublicationRow | null> {
    return this.prisma.publication.findUnique({ where: { id }, include: publicationInclude });
  }

  checkpointOf(pub: { checkpoint: unknown }): RunnerCheckpoint {
    return (pub.checkpoint && typeof pub.checkpoint === 'object' ? pub.checkpoint : {}) as RunnerCheckpoint;
  }

  /**
   * Moves a publication to `to` with optimistic locking, then recomputes the post rollup in the same transaction.
   * Returns the updated row plus events to dispatch after commit.
   */
  async transition(
    pub: PublicationRow,
    to: PublicationStatus,
    patch: PublicationPatch = {},
  ): Promise<{ pub: PublicationRow; events: TransitionEvents }> {
    assertTransition(pub.status, to);
    const { checkpoint, mediaVariantId, ...rest } = patch;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.publication.updateMany({
        where: { id: pub.id, version: pub.version },
        data: {
          ...rest,
          ...(checkpoint ? { checkpoint: toJsonValue(checkpoint) as Prisma.InputJsonValue } : {}),
          status: to,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new ConcurrentModificationError(pub.id);
      if (mediaVariantId !== undefined) {
        await tx.publication.update({ where: { id: pub.id }, data: { mediaVariantId } });
      }
      const updated = await tx.publication.findUniqueOrThrow({ where: { id: pub.id }, include: publicationInclude });
      const events: TransitionEvents = { needsAction: to === 'NEEDS_USER_ACTION' && pub.status !== 'NEEDS_USER_ACTION' };
      const rollup = await this.recomputePost(tx, pub.postId);
      if (rollup.postBecameTerminal) events.postBecameTerminal = rollup.postBecameTerminal;
      if (rollup.mediaCleanup) events.mediaCleanup = rollup.mediaCleanup;
      return { pub: updated, events };
    });
  }

  /** Saves checkpoint changes without changing status (still version-checked). */
  async saveCheckpoint(pub: PublicationRow, changes: RunnerCheckpoint, patch: PublicationPatch = {}): Promise<PublicationRow> {
    const merged = mergeCheckpoint(this.checkpointOf(pub), changes);
    const { checkpoint: _ignored, ...rest } = patch;
    const result = await this.prisma.publication.updateMany({
      where: { id: pub.id, version: pub.version },
      data: { ...rest, checkpoint: toJsonValue(merged) as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConcurrentModificationError(pub.id);
    return this.prisma.publication.findUniqueOrThrow({ where: { id: pub.id }, include: publicationInclude });
  }

  /**
   * Updates the post status; returns details when the post just reached a terminal status for the first time
   * (for user notification), and separately whenever every publication for the post is now terminal (for media
   * cleanup — this can be true even when the post itself rolled up to CANCELLED, which is excluded from
   * notification but still means nothing further will ever run for this post).
   */
  async recomputePost(
    tx: PrismaTx,
    postId: string,
  ): Promise<{ postBecameTerminal: TransitionEvents['postBecameTerminal'] | null; mediaCleanup: TransitionEvents['mediaCleanup'] | null }> {
    const post = await tx.post.findUniqueOrThrow({ where: { id: postId }, include: { publications: { select: { status: true } } } });
    const status = rollupPostStatus(post.publications.map((p) => p.status));
    const allTerminal = post.publications.every((p) => isTerminal(p.status));
    const videoNoLongerNeeded = post.publications.every((p) => p.status === 'PUBLISHED' || p.status === 'CANCELLED');
    const firstTerminal = allTerminal && !post.notifiedAt && status !== 'CANCELLED';
    if (status !== post.status || firstTerminal) {
      await tx.post.update({ where: { id: postId }, data: { status, ...(firstTerminal ? { notifiedAt: new Date() } : {}) } });
    }
    return {
      postBecameTerminal: firstTerminal ? { postId, userId: post.userId, status } : null,
      mediaCleanup: videoNoLongerNeeded ? { mediaId: post.mediaId, postId } : null,
    };
  }
}

/** Shallow-merges runner keys and deep-merges one level for adapter namespaces. `null` deletes a key. */
export function mergeCheckpoint(base: RunnerCheckpoint, changes: RunnerCheckpoint): RunnerCheckpoint {
  const out: RunnerCheckpoint = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete out[key];
    else if (value !== undefined && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key] !== null) {
      out[key] = { ...(out[key] as object), ...(value as object) };
    } else if (value !== undefined) out[key] = value;
  }
  return out;
}
