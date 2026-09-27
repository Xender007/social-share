import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { MeResponse, TokenResponse } from '@sp/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import type { AuthUser, RequestMeta } from '../common/request-context';
import { addDays } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './passwords';

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const invalidCredentials = () =>
  new AppError('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect.', HttpStatus.UNAUTHORIZED);
const sessionExpired = () =>
  new AppError('AUTH_TOKEN_EXPIRED', 'Your session has expired. Please sign in again.', HttpStatus.UNAUTHORIZED);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failedLogins = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, deviceName: string | undefined, meta: RequestMeta): Promise<TokenResponse> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

    if (!user || !ok || user.status !== 'ACTIVE') {
      const failures = (this.failedLogins.get(normalized) ?? 0) + 1;
      this.failedLogins.set(normalized, failures);
      if (failures === 3) {
        await this.audit.record({ action: 'auth.login.failed', entityType: 'user', entityId: user?.id, newValue: { email: normalized, failures }, meta });
      }
      throw invalidCredentials();
    }

    this.failedLogins.delete(normalized);
    return this.issueTokens(user.id, randomUUID(), deviceName);
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw sessionExpired();

    if (session.usedAt) {
      await this.revokeFamily(session.familyId);
      this.logger.warn(`Refresh token reuse detected; revoked session family ${session.familyId}`);
      throw new AppError('AUTH_REFRESH_REUSED', 'Your session was ended for security. Please sign in again.', HttpStatus.UNAUTHORIZED);
    }

    // Conditional update closes the race where two refreshes use the same token at once.
    const claimed = await this.prisma.refreshSession.updateMany({
      where: { id: session.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.revokeFamily(session.familyId);
      throw new AppError('AUTH_REFRESH_REUSED', 'Your session was ended for security. Please sign in again.', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'ACTIVE') throw sessionExpired();
    return this.issueTokens(user.id, session.familyId, session.deviceName ?? undefined);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (session) await this.revokeFamily(session.familyId);
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw sessionExpired();
    }
    const live = await this.prisma.refreshSession.findFirst({
      where: { familyId: payload.sid, userId: payload.sub, revokedAt: null },
      select: { id: true },
    });
    if (!live) throw sessionExpired();
    return { id: payload.sub, sessionFamilyId: payload.sid };
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { accessLevel: true } });
    return { id: user.id, email: user.email, displayName: user.displayName, accessLevel: user.accessLevel.code };
  }

  async updateDisplayName(userId: string, displayName: string, meta: RequestMeta): Promise<MeResponse> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { accessLevel: true } });
    const after = await this.prisma.user.update({ where: { id: userId }, data: { displayName }, include: { accessLevel: true } });
    await this.audit.record({
      actorUserId: userId,
      action: 'user.updated',
      entityType: 'user',
      entityId: userId,
      oldValue: { displayName: before.displayName },
      newValue: { displayName: after.displayName },
      meta,
    });
    return { id: after.id, email: after.email, displayName: after.displayName, accessLevel: after.accessLevel.code };
  }

  private async issueTokens(userId: string, familyId: string, deviceName: string | undefined): Promise<TokenResponse> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshSession.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        deviceName: deviceName ?? null,
        expiresAt: addDays(new Date(), this.config.env.REFRESH_TOKEN_TTL_DAYS),
      },
    });
    const expiresIn = this.config.env.JWT_ACCESS_TTL_SECONDS;
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: familyId } satisfies AccessTokenPayload, { expiresIn });
    return { accessToken, refreshToken, expiresIn };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
