export const PROVIDER_KINDS = ['GOOGLE', 'META'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const CONNECTION_STATUSES = ['CONNECTED', 'REFRESH_FAILING', 'REAUTH_REQUIRED', 'DISCONNECTED'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const SOCIAL_ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'NOT_ELIGIBLE', 'REAUTH_REQUIRED', 'DISCONNECTED'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const MEDIA_STATUSES = ['PENDING_UPLOAD', 'UPLOADED', 'PROBING', 'READY', 'INVALID', 'DELETED'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const POST_STATUSES = [
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'PARTIALLY_PUBLISHED',
  'NEEDS_ATTENTION',
  'FAILED',
  'CANCELLED',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const PUBLICATION_STATUSES = [
  'PENDING_MEDIA',
  'QUEUED',
  'IN_PROGRESS',
  'WAITING_PROVIDER',
  'RETRY_SCHEDULED',
  'UNKNOWN_OUTCOME',
  'NEEDS_USER_ACTION',
  'PAUSED',
  'PUBLISHED',
  'FAILED_FINAL',
  'CANCELLED',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const TERMINAL_PUBLICATION_STATUSES: readonly PublicationStatus[] = ['PUBLISHED', 'FAILED_FINAL', 'CANCELLED'];

export function isTerminalPublicationStatus(status: PublicationStatus): boolean {
  return TERMINAL_PUBLICATION_STATUSES.includes(status);
}

export const ERROR_CATEGORIES = [
  'TRANSIENT',
  'RATE_LIMITED',
  'PROVIDER_LIMIT',
  'UNKNOWN_OUTCOME',
  'AUTH',
  'MEDIA_INVALID',
  'PERMISSION',
  'VALIDATION',
  'INTERNAL',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const PUBLICATION_ACTIONS = ['RETRY', 'CANCEL', 'RECONNECT', 'MARK_PUBLISHED', 'PUBLISH_AGAIN', 'OPEN'] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];
