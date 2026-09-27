import type { ErrorCategory, PostStatus, PublicationAction, PublicationStatus } from '@sp/contracts';

/** Allowed publication transitions (§18.1). Anything not listed is a bug and is rejected. */
const TRANSITIONS: Record<PublicationStatus, readonly PublicationStatus[]> = {
  PENDING_MEDIA: ['QUEUED', 'NEEDS_USER_ACTION', 'CANCELLED'],
  QUEUED: ['IN_PROGRESS', 'PAUSED', 'CANCELLED', 'NEEDS_USER_ACTION', 'UNKNOWN_OUTCOME'],
  IN_PROGRESS: ['WAITING_PROVIDER', 'PUBLISHED', 'RETRY_SCHEDULED', 'UNKNOWN_OUTCOME', 'NEEDS_USER_ACTION', 'FAILED_FINAL', 'PAUSED', 'QUEUED', 'IN_PROGRESS', 'PENDING_MEDIA'],
  WAITING_PROVIDER: ['IN_PROGRESS', 'RETRY_SCHEDULED', 'NEEDS_USER_ACTION', 'PAUSED', 'PUBLISHED', 'QUEUED'],
  RETRY_SCHEDULED: ['IN_PROGRESS', 'FAILED_FINAL', 'CANCELLED', 'PAUSED', 'NEEDS_USER_ACTION', 'QUEUED'],
  UNKNOWN_OUTCOME: ['PUBLISHED', 'QUEUED', 'WAITING_PROVIDER', 'NEEDS_USER_ACTION'],
  NEEDS_USER_ACTION: ['QUEUED', 'PUBLISHED', 'CANCELLED'],
  PAUSED: ['QUEUED', 'CANCELLED'],
  PUBLISHED: [],
  FAILED_FINAL: ['QUEUED'],
  CANCELLED: [],
};

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: PublicationStatus,
    readonly to: PublicationStatus,
  ) {
    super(`Invalid publication transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: PublicationStatus, to: PublicationStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

const TERMINAL: readonly PublicationStatus[] = ['PUBLISHED', 'FAILED_FINAL', 'CANCELLED'];
export const isTerminal = (status: PublicationStatus): boolean => TERMINAL.includes(status);

/** Post status derived from its publications (§16.5). */
export function rollupPostStatus(statuses: PublicationStatus[]): PostStatus {
  if (statuses.length === 0) return 'CANCELLED';
  if (statuses.every((s) => s === 'CANCELLED')) return 'CANCELLED';
  if (statuses.some((s) => s === 'NEEDS_USER_ACTION' || s === 'UNKNOWN_OUTCOME')) return 'NEEDS_ATTENTION';
  if (statuses.every(isTerminal)) {
    const live = statuses.filter((s) => s !== 'CANCELLED');
    const published = live.filter((s) => s === 'PUBLISHED').length;
    if (published === live.length) return 'PUBLISHED';
    if (published > 0) return 'PARTIALLY_PUBLISHED';
    return 'FAILED';
  }
  return 'PUBLISHING';
}

/** Buttons the app may show for a publication (§16.4). Computed server-side so clients never guess. */
export function allowedActions(
  status: PublicationStatus,
  errorCategory: ErrorCategory | null,
  context: { hadUnknownOutcome: boolean; hasExternalUrl: boolean },
): PublicationAction[] {
  switch (status) {
    case 'PENDING_MEDIA':
    case 'QUEUED':
    case 'RETRY_SCHEDULED':
    case 'PAUSED':
      return ['CANCEL'];
    case 'IN_PROGRESS':
    case 'WAITING_PROVIDER':
    case 'UNKNOWN_OUTCOME':
      return [];
    case 'NEEDS_USER_ACTION':
      if (context.hadUnknownOutcome) return ['MARK_PUBLISHED', 'PUBLISH_AGAIN', 'CANCEL'];
      if (errorCategory === 'AUTH') return ['RECONNECT', 'CANCEL'];
      return ['RETRY', 'CANCEL'];
    case 'FAILED_FINAL':
      return ['RETRY'];
    case 'PUBLISHED':
      return context.hasExternalUrl ? ['OPEN'] : [];
    case 'CANCELLED':
      return [];
  }
}

export interface FailureOutcome {
  status: PublicationStatus;
  consumesAttempt: boolean;
  notify: boolean;
}

/** What the runner does with a classified error (§18.4). */
export function outcomeForError(
  category: ErrorCategory,
  attemptsSoFar: number,
  maxAttempts: number,
  options: { retryAfterMs?: number } = {},
): FailureOutcome {
  const exhausted = attemptsSoFar + 1 >= maxAttempts;
  switch (category) {
    case 'TRANSIENT':
      return exhausted ? { status: 'FAILED_FINAL', consumesAttempt: true, notify: true } : { status: 'RETRY_SCHEDULED', consumesAttempt: true, notify: false };
    case 'RATE_LIMITED':
      return { status: 'RETRY_SCHEDULED', consumesAttempt: false, notify: (options.retryAfterMs ?? 0) > 3_600_000 };
    case 'PROVIDER_LIMIT':
      return (options.retryAfterMs ?? Infinity) <= 24 * 3_600_000
        ? { status: 'RETRY_SCHEDULED', consumesAttempt: false, notify: true }
        : { status: 'NEEDS_USER_ACTION', consumesAttempt: false, notify: true };
    case 'UNKNOWN_OUTCOME':
      return { status: 'UNKNOWN_OUTCOME', consumesAttempt: false, notify: false };
    case 'AUTH':
    case 'PERMISSION':
    case 'MEDIA_INVALID':
      return { status: 'NEEDS_USER_ACTION', consumesAttempt: category === 'MEDIA_INVALID', notify: true };
    case 'VALIDATION':
      return { status: 'FAILED_FINAL', consumesAttempt: true, notify: true };
    case 'INTERNAL':
      return attemptsSoFar + 1 >= Math.min(3, maxAttempts)
        ? { status: 'FAILED_FINAL', consumesAttempt: true, notify: true }
        : { status: 'RETRY_SCHEDULED', consumesAttempt: true, notify: false };
  }
}
