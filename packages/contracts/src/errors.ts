export const ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_REFRESH_REUSED',
  'AUTH_REQUIRED',
  'CAPABILITY_DENIED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'PUBLICATION_CHANGED',
  'ACTION_NOT_ALLOWED',
  'MEDIA_NOT_READY',
  'MEDIA_INVALID',
  'MEDIA_INCOMPATIBLE',
  'UPLOAD_SIZE_MISMATCH',
  'UPLOAD_TOO_LARGE',
  'DESTINATION_UNAVAILABLE',
  'TEXT_LIMIT',
  'OAUTH_STATE_INVALID',
  'CONNECTION_NOT_ELIGIBLE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}
