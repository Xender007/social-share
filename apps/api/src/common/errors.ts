import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@sp/contracts';

/** Domain error carrying a stable API error code. Mapped to the §28 error format by ApiExceptionFilter. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);

export const actionNotAllowed = (message: string, details?: unknown) =>
  new AppError('ACTION_NOT_ALLOWED', message, HttpStatus.CONFLICT, details);

export const validationFailed = (message: string, details?: unknown) =>
  new AppError('VALIDATION_FAILED', message, HttpStatus.UNPROCESSABLE_ENTITY, details);
