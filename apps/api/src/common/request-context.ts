import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface AuthUser {
  id: string;
  sessionFamilyId: string;
}

export interface AppRequest extends Request {
  requestId: string;
  user?: AuthUser;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[\w-]{8,100}$/.test(incoming) ? incoming : `req_${randomUUID()}`;
  (req as AppRequest).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export const IS_PUBLIC = 'sp:isPublic';
/** Marks a route as not requiring an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_CAPABILITY = 'sp:requiredCapability';
/** Requires a resolved capability (e.g. `global.admin`) before the handler runs. */
export const RequireCapability = (capability: string) => SetMetadata(REQUIRED_CAPABILITY, capability);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});

export const ReqContext = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return { requestId: req.requestId, ip: req.ip ?? null };
});

export interface RequestMeta {
  requestId: string;
  ip: string | null;
}
