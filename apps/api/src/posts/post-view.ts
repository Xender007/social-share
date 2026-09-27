import type { PostView, PublicationView } from '@sp/contracts';
import { iso, isoOrNull } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import type { RunnerCheckpoint } from '../publishing/publication.repository';
import { allowedActions } from '../publishing/state-machine';

export const postViewInclude = {
  media: true,
  publications: {
    include: { platform: true, socialAccount: true },
    orderBy: { platform: { sortOrder: 'asc' } },
  },
} satisfies Prisma.PostInclude;

export type PostWithRelations = Prisma.PostGetPayload<{ include: typeof postViewInclude }>;
type PublicationWithRelations = PostWithRelations['publications'][number];

export function toPublicationView(pub: PublicationWithRelations): PublicationView {
  const checkpoint = (pub.checkpoint ?? {}) as RunnerCheckpoint;
  const hasError = pub.errorCode || pub.errorMessage;
  return {
    id: pub.id,
    platform: pub.platform.code,
    platformName: pub.platform.name,
    socialAccountId: pub.socialAccountId,
    accountName: pub.socialAccount.handle ?? pub.socialAccount.displayName,
    status: pub.status,
    step: pub.currentStep,
    attemptCount: pub.attemptCount,
    externalId: pub.externalId,
    externalUrl: pub.externalUrl,
    error:
      hasError && pub.status !== 'PUBLISHED'
        ? { category: pub.errorCategory, code: pub.errorCode, message: pub.errorMessage, providerCode: pub.providerErrorCode }
        : null,
    actions: allowedActions(pub.status, pub.errorCategory, {
      hadUnknownOutcome: Boolean(checkpoint.hadUnknownOutcome),
      hasExternalUrl: Boolean(pub.externalUrl),
    }),
    nextAttemptAt: isoOrNull(pub.nextAttemptAt),
    publishedAt: isoOrNull(pub.publishedAt),
    updatedAt: iso(pub.updatedAt),
  };
}

export function toPostView(post: PostWithRelations): PostView {
  return {
    id: post.id,
    status: post.status,
    title: post.title,
    caption: post.caption,
    media: {
      id: post.media.id,
      status: post.media.status,
      durationMs: post.media.durationMs,
      width: post.media.width,
      height: post.media.height,
      originalFilename: post.media.originalFilename,
    },
    publications: post.publications.map(toPublicationView),
    createdAt: iso(post.createdAt),
    updatedAt: iso(post.updatedAt),
  };
}
