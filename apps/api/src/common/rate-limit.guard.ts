import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from './errors';
import type { AppRequest } from './request-context';

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}

const RATE_LIMIT = 'sp:rateLimit';
const DEFAULT_LIMIT: RateLimitOptions = { bucket: 'default', limit: 120, windowMs: 60_000 };

/** Overrides the default per-user/IP limit (120 requests per minute) for a route. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

/** In-memory fixed-window limiter. Sufficient for a single API instance; swap for a shared store when scaling out. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT, [context.getHandler(), context.getClass()]) ??
      DEFAULT_LIMIT;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const subject = req.user?.id ?? req.ip ?? 'anonymous';
    const key = `${options.bucket}:${subject}`;
    const now = Date.now();

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + options.windowMs });
      this.sweep(now);
      return true;
    }
    entry.count += 1;
    if (entry.count > options.limit) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS, {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
    return true;
  }

  private sweep(now: number): void {
    if (this.hits.size < 5000) return;
    for (const [key, value] of this.hits) if (value.resetAt <= now) this.hits.delete(key);
  }
}
