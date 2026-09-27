import type { PublicationStatus } from '@sp/contracts';
import { pollDelayMs, retryDelayMs } from './backoff';
import { allowedActions, assertTransition, canTransition, outcomeForError, rollupPostStatus } from './state-machine';

describe('publication transitions', () => {
  it.each<[PublicationStatus, PublicationStatus]>([
    ['PENDING_MEDIA', 'QUEUED'],
    ['QUEUED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'WAITING_PROVIDER'],
    ['WAITING_PROVIDER', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'PUBLISHED'],
    ['IN_PROGRESS', 'UNKNOWN_OUTCOME'],
    ['UNKNOWN_OUTCOME', 'PUBLISHED'],
    ['UNKNOWN_OUTCOME', 'QUEUED'],
    ['UNKNOWN_OUTCOME', 'NEEDS_USER_ACTION'],
    ['NEEDS_USER_ACTION', 'PUBLISHED'],
    ['FAILED_FINAL', 'QUEUED'],
    ['PAUSED', 'QUEUED'],
    ['RETRY_SCHEDULED', 'FAILED_FINAL'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each<[PublicationStatus, PublicationStatus]>([
    ['PUBLISHED', 'QUEUED'],
    ['PUBLISHED', 'IN_PROGRESS'],
    ['CANCELLED', 'QUEUED'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['WAITING_PROVIDER', 'CANCELLED'],
    ['UNKNOWN_OUTCOME', 'IN_PROGRESS'],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(`${from} -> ${to}`);
  });

  it('a published publication can never be published again', () => {
    expect(canTransition('PUBLISHED', 'PUBLISHED')).toBe(false);
  });
});

describe('rollupPostStatus', () => {
  it.each<[PublicationStatus[], string]>([
    [['PUBLISHED', 'PUBLISHED', 'PUBLISHED'], 'PUBLISHED'],
    [['PUBLISHED', 'CANCELLED'], 'PUBLISHED'],
    [['PUBLISHED', 'FAILED_FINAL'], 'PARTIALLY_PUBLISHED'],
    [['FAILED_FINAL', 'CANCELLED'], 'FAILED'],
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
    [['PUBLISHED', 'NEEDS_USER_ACTION'], 'NEEDS_ATTENTION'],
    [['QUEUED', 'UNKNOWN_OUTCOME'], 'NEEDS_ATTENTION'],
    [['PUBLISHED', 'IN_PROGRESS'], 'PUBLISHING'],
    [['PENDING_MEDIA'], 'PUBLISHING'],
  ])('%j -> %s', (statuses, expected) => {
    expect(rollupPostStatus(statuses)).toBe(expected);
  });
});

describe('allowedActions', () => {
  const ctx = { hadUnknownOutcome: false, hasExternalUrl: false };
  it('offers reconnect for auth problems', () => {
    expect(allowedActions('NEEDS_USER_ACTION', 'AUTH', ctx)).toEqual(['RECONNECT', 'CANCEL']);
  });
  it('offers confirm/publish-again after an uncertain outcome', () => {
    expect(allowedActions('NEEDS_USER_ACTION', 'UNKNOWN_OUTCOME', { ...ctx, hadUnknownOutcome: true })).toEqual([
      'MARK_PUBLISHED',
      'PUBLISH_AGAIN',
      'CANCEL',
    ]);
  });
  it('offers nothing while the provider works', () => {
    expect(allowedActions('IN_PROGRESS', null, ctx)).toEqual([]);
    expect(allowedActions('WAITING_PROVIDER', null, ctx)).toEqual([]);
  });
  it('offers open for published with a link', () => {
    expect(allowedActions('PUBLISHED', null, { ...ctx, hasExternalUrl: true })).toEqual(['OPEN']);
  });
  it('offers retry after final failure', () => {
    expect(allowedActions('FAILED_FINAL', 'TRANSIENT', ctx)).toEqual(['RETRY']);
  });
});

describe('outcomeForError', () => {
  it('retries transient errors until attempts run out', () => {
    expect(outcomeForError('TRANSIENT', 0, 6)).toMatchObject({ status: 'RETRY_SCHEDULED', consumesAttempt: true });
    expect(outcomeForError('TRANSIENT', 5, 6)).toMatchObject({ status: 'FAILED_FINAL', notify: true });
  });
  it('rate limits do not consume attempts', () => {
    expect(outcomeForError('RATE_LIMITED', 5, 6)).toMatchObject({ status: 'RETRY_SCHEDULED', consumesAttempt: false, notify: false });
    expect(outcomeForError('RATE_LIMITED', 0, 6, { retryAfterMs: 2 * 3_600_000 }).notify).toBe(true);
  });
  it('unknown outcomes go to reconciliation, never a blind retry', () => {
    expect(outcomeForError('UNKNOWN_OUTCOME', 0, 6)).toMatchObject({ status: 'UNKNOWN_OUTCOME', consumesAttempt: false });
  });
  it('auth problems need the user', () => {
    expect(outcomeForError('AUTH', 0, 6)).toMatchObject({ status: 'NEEDS_USER_ACTION', notify: true });
  });
  it('validation bugs fail immediately', () => {
    expect(outcomeForError('VALIDATION', 0, 6).status).toBe('FAILED_FINAL');
  });
  it('internal errors retry at most 3 times', () => {
    expect(outcomeForError('INTERNAL', 1, 6).status).toBe('RETRY_SCHEDULED');
    expect(outcomeForError('INTERNAL', 2, 6).status).toBe('FAILED_FINAL');
  });
  it('publishing caps retry after the window when it is under 24h', () => {
    expect(outcomeForError('PROVIDER_LIMIT', 0, 6, { retryAfterMs: 3_600_000 }).status).toBe('RETRY_SCHEDULED');
    expect(outcomeForError('PROVIDER_LIMIT', 0, 6).status).toBe('NEEDS_USER_ACTION');
  });
});

describe('backoff', () => {
  it('follows 1m, 5m, 15m, 1h, 4h with jitter bounds', () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(60_000);
    expect(retryDelayMs(2, () => 0)).toBe(240_000);
    expect(retryDelayMs(5, () => 1)).toBe(4 * 3_600_000 * 1.2);
    expect(retryDelayMs(99, () => 0.5)).toBe(4 * 3_600_000);
  });
  it('polls quickly then every 2 minutes', () => {
    expect([0, 1, 2, 3, 4, 10].map(pollDelayMs)).toEqual([10_000, 20_000, 30_000, 60_000, 120_000, 120_000]);
  });
});
