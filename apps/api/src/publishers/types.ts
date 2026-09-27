import type { ErrorCategory } from '@sp/contracts';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import type { MediaRules, ProbeResult, ValidationIssue } from '../media-processing/rules';

/** Adapter-owned state persisted between steps (provider IDs, upload session URIs, byte offsets). */
export type Checkpoint = Record<string, unknown>;

export type StepResult =
  | { kind: 'advance'; nextStep: string; checkpoint?: Checkpoint }
  | { kind: 'wait'; step: string; pollAfterMs?: number; checkpoint?: Checkpoint }
  | { kind: 'done'; externalId: string; externalUrl?: string; checkpoint?: Checkpoint };

export type ReconcileResult =
  | { kind: 'published'; externalId: string; externalUrl?: string; checkpoint?: Checkpoint }
  | { kind: 'in_progress'; step: string; checkpoint?: Checkpoint }
  | { kind: 'not_published'; resumeFromStep: string; checkpoint?: Checkpoint }
  | { kind: 'undeterminable'; hint: string };

export interface ClassifiedError {
  category: ErrorCategory;
  /** Our stable code, e.g. YT_QUOTA_EXCEEDED. */
  code: string;
  providerCode?: string;
  httpStatus?: number;
  /** Safe to show to the user. */
  userMessage: string;
  retryAfterMs?: number;
  /** True when we know the failed call changed nothing at the provider, so an in-flight marker can be cleared. */
  requestHadNoEffect: boolean;
}

/** Errors adapters throw once they've classified a provider failure. */
export class ProviderError extends Error {
  constructor(readonly classified: ClassifiedError) {
    super(`${classified.code}: ${classified.userMessage}`);
    this.name = 'ProviderError';
  }
}

export interface ProviderCredentials {
  accessToken: string;
  /** e.g. a Facebook Page token for the destination. */
  destinationToken?: string;
}

export interface PublishContext {
  publication: {
    id: string;
    attemptCount: number;
    pollCount: number;
    waitingSince: Date | null;
    inFlightStartedAt: Date | null;
  };
  /** This adapter's checkpoint namespace. */
  checkpoint: Checkpoint;
  account: { id: string; externalAccountId: string; displayName: string; metadata: Record<string, unknown> };
  credentials(): Promise<ProviderCredentials>;
  media: {
    probe: ProbeResult;
    sizeBytes: number;
    contentType: string;
    signedUrl(ttlSeconds: number): Promise<string>;
    openRange(start: number, endInclusive: number): Promise<Readable>;
  };
  text: { title?: string; caption?: string };
  options: Record<string, unknown>;
  config: { apiVersion: string; apiBaseUrl: string };
  signal: AbortSignal;
}

export interface SocialPublisher {
  readonly platformCode: string;
  readonly initialStep: string;
  readonly nonIdempotentSteps: ReadonlySet<string>;
  readonly optionsSchema: z.ZodType<Record<string, unknown>>;

  /** Adapter-specific checks beyond the shared media rules (e.g. title required). */
  validate(probe: ProbeResult, text: { title?: string; caption?: string }, rules: MediaRules): ValidationIssue[];
  runStep(step: string, ctx: PublishContext): Promise<StepResult>;
  reconcile(ctx: PublishContext): Promise<ReconcileResult>;
  classifyError(error: unknown, step: string, meta: { nonIdempotent: boolean }): ClassifiedError;
  stepTimeoutMs(step: string): number;
  maxWaitMs(step: string): number;
}

/** Fallback classification for errors an adapter didn't recognize. */
export function classifyUnknownError(error: unknown, nonIdempotent: boolean): ClassifiedError {
  if (error instanceof ProviderError) return error.classified;
  const err = error as { name?: string; code?: string; cause?: { code?: string } };
  const networkCode = err?.code ?? err?.cause?.code;
  const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError' || networkCode === 'ETIMEDOUT' || networkCode === 'ECONNRESET';
  const beforeSend = networkCode === 'ECONNREFUSED' || networkCode === 'ENOTFOUND' || networkCode === 'EAI_AGAIN';
  if (beforeSend) {
    return { category: 'TRANSIENT', code: 'NETWORK_UNREACHABLE', userMessage: 'Could not reach the platform. Will retry.', requestHadNoEffect: true };
  }
  if (isTimeout) {
    return nonIdempotent
      ? { category: 'UNKNOWN_OUTCOME', code: 'TIMEOUT_AFTER_SEND', userMessage: 'The platform did not respond in time.', requestHadNoEffect: false }
      : { category: 'TRANSIENT', code: 'TIMEOUT', userMessage: 'The platform did not respond in time. Will retry.', requestHadNoEffect: true };
  }
  return { category: 'INTERNAL', code: 'INTERNAL_ERROR', userMessage: 'Something went wrong on our side.', requestHadNoEffect: !nonIdempotent };
}
