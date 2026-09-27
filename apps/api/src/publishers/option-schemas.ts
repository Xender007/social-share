import type { ValidationIssue } from '../media-processing/rules';
import { z } from 'zod';

/** Test hooks honoured only by the fake publisher (PROVIDER_MODE=fake). Stripped in live mode. */
export const fakeScenarioSchema = z
  .object({
    waitPolls: z.number().int().min(0).max(20).optional(),
    failAt: z.string().optional(),
    failWith: z.enum(['TRANSIENT', 'RATE_LIMITED', 'AUTH', 'MEDIA_INVALID', 'VALIDATION', 'PERMISSION']).optional(),
    failTimes: z.number().int().min(1).max(10).optional(),
    crashAfterSendAt: z.string().optional(),
  })
  .optional();

export const youtubeOptionsSchema = z.object({
  privacyStatus: z.enum(['public', 'unlisted', 'private']).default('private'),
  madeForKids: z.boolean({ error: 'Choose whether this video is made for kids' }),
  categoryId: z.string().regex(/^\d+$/).default('22'),
  fake: fakeScenarioSchema,
});

export const instagramOptionsSchema = z.object({
  shareToFeed: z.boolean().default(true),
  coverFrameMs: z.number().int().min(0).default(0),
  fake: fakeScenarioSchema,
});

export const facebookOptionsSchema = z.object({
  fake: fakeScenarioSchema,
});

export const OPTION_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  youtube: youtubeOptionsSchema,
  instagram: instagramOptionsSchema,
  facebook: facebookOptionsSchema,
};

/** Text checks shared by real and fake adapters. */
export function textIssues(platformCode: string, text: { title?: string; caption?: string }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (platformCode === 'youtube') {
    const title = text.title?.trim() || text.caption?.split('\n')[0]?.trim();
    if (!title) issues.push({ code: 'TITLE_REQUIRED', fixableByTranscode: false, message: 'YouTube needs a title.' });
    if (title && /[<>]/.test(title)) issues.push({ code: 'TITLE_CHARACTERS', fixableByTranscode: false, message: 'YouTube titles cannot contain < or >.' });
  }
  if (platformCode === 'instagram' && text.caption) {
    const hashtags = text.caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (hashtags > 30) issues.push({ code: 'TOO_MANY_HASHTAGS', fixableByTranscode: false, message: 'Instagram allows at most 30 hashtags.' });
  }
  return issues;
}

/** YouTube requires a title: fall back to the first caption line, truncated. */
export function effectiveYoutubeTitle(text: { title?: string; caption?: string }): string {
  const raw = text.title?.trim() || text.caption?.split('\n')[0]?.trim() || 'Untitled';
  return raw.replace(/[<>]/g, '').slice(0, 100);
}
