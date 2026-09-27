import { z } from 'zod';
import type { ErrorCategory, MediaStatus, PostStatus, PublicationAction, PublicationStatus } from './enums';

export const destinationSchema = z.object({
  socialAccountId: z.uuid(),
  titleOverride: z.string().max(500).optional(),
  captionOverride: z.string().max(10000).optional(),
  options: z.record(z.string(), z.unknown()).default({}),
});
export type DestinationInput = z.infer<typeof destinationSchema>;

export const createPostSchema = z.object({
  mediaId: z.uuid(),
  title: z.string().max(500).optional(),
  caption: z.string().max(10000).optional(),
  destinations: z.array(destinationSchema).min(1).max(10),
});
export type CreatePostRequest = z.infer<typeof createPostSchema>;

export const resolvePublicationSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('PUBLISHED'), externalUrl: z.url().max(2000).optional() }),
  z.object({ outcome: z.literal('NOT_PUBLISHED') }),
]);
export type ResolvePublicationRequest = z.infer<typeof resolvePublicationSchema>;

export interface PublicationError {
  category: ErrorCategory | null;
  code: string | null;
  message: string | null;
  providerCode: string | null;
}

export interface PublicationView {
  id: string;
  platform: string;
  platformName: string;
  socialAccountId: string;
  accountName: string;
  status: PublicationStatus;
  step: string | null;
  attemptCount: number;
  externalId: string | null;
  externalUrl: string | null;
  error: PublicationError | null;
  actions: PublicationAction[];
  nextAttemptAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PostView {
  id: string;
  status: PostStatus;
  title: string | null;
  caption: string | null;
  media: {
    id: string;
    status: MediaStatus;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    originalFilename: string | null;
  };
  publications: PublicationView[];
  createdAt: string;
  updatedAt: string;
}

export interface PostListResponse {
  items: PostView[];
  nextCursor: string | null;
}

export interface ValidationIssueView {
  code: string;
  fixableByTranscode: boolean;
  message: string;
}
