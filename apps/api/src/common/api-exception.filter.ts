import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@sp/contracts';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_REQUIRED',
  403: 'CAPABILITY_DENIED',
  404: 'NOT_FOUND',
  413: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string }>();
    const res = http.getResponse<Response>();
    const requestId = req?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody['error'] = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      body = {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid.',
        details: exception.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      body = { code: STATUS_CODES[status] ?? 'INTERNAL_ERROR', message: Array.isArray(message) ? message.join(', ') : message };
    } else {
      this.logger.error(
        `Unhandled error on ${req?.method} ${req?.url} requestId=${requestId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({ error: { ...body, requestId } } satisfies ApiErrorBody);
  }
}
