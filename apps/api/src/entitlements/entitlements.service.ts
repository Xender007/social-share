import { CanActivate, ExecutionContext, Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors';
import { AppRequest, REQUIRED_CAPABILITY } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { allCapabilityKeys, capabilityLabel, Decision, EntitlementSnapshot, resolveCapability } from './resolver';

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string): Promise<EntitlementSnapshot> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { accessLevel: true } });
    const [platforms, features, platformFeatures, accessLevelCapabilities, overrides, killSwitches] = await Promise.all([
      this.prisma.platform.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.feature.findMany(),
      this.prisma.platformFeature.findMany({ select: { platformId: true, featureId: true, enabled: true } }),
      this.prisma.accessLevelCapability.findMany({
        where: { accessLevelId: user.accessLevelId },
        select: { platformId: true, featureId: true, allowed: true },
      }),
      this.prisma.userCapabilityOverride.findMany({
        where: { userId },
        select: { platformId: true, featureId: true, effect: true, expiresAt: true },
      }),
      this.prisma.killSwitch.findMany({ where: { active: true }, select: { platformId: true, featureId: true, active: true } }),
    ]);
    return {
      now: new Date(),
      user: {
        id: user.id,
        status: user.status,
        accessLevelId: user.accessLevelId,
        accessLevelCode: user.accessLevel.code,
        accessLevelEnabled: user.accessLevel.enabled,
      },
      platforms: platforms.map((p) => ({ id: p.id, code: p.code, name: p.name, enabled: p.enabled })),
      features: features.map((f) => ({ id: f.id, code: f.code, name: f.name, scope: f.scope, enabled: f.enabled })),
      platformFeatures,
      accessLevelCapabilities,
      overrides,
      killSwitches,
    };
  }

  async decide(userId: string, capability: string): Promise<Decision> {
    return resolveCapability(await this.snapshot(userId), capability);
  }

  async can(userId: string, capability: string): Promise<boolean> {
    return (await this.decide(userId, capability)).allowed;
  }

  /** Throws 403 CAPABILITY_DENIED with a friendly message when the capability is not allowed. */
  async assert(userId: string, capability: string, snapshot?: EntitlementSnapshot): Promise<void> {
    const snap = snapshot ?? (await this.snapshot(userId));
    const decision = resolveCapability(snap, capability);
    if (decision.allowed) return;
    const label = capabilityLabel(snap, capability);
    const message =
      decision.reason === 'KILL_SWITCH'
        ? `${label} is temporarily paused.`
        : decision.reason === 'UNKNOWN_CAPABILITY'
          ? `${label} is not available.`
          : `${label} isn't available on your account.`;
    throw new AppError('CAPABILITY_DENIED', message, HttpStatus.FORBIDDEN, { capability, reason: decision.reason });
  }

  async resolveAll(userId: string): Promise<{ snapshot: EntitlementSnapshot; decisions: Map<string, Decision> }> {
    const snapshot = await this.snapshot(userId);
    const decisions = new Map(allCapabilityKeys(snapshot).map((key) => [key, resolveCapability(snapshot, key)]));
    return { snapshot, decisions };
  }
}

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const capability = this.reflector.getAllAndOverride<string>(REQUIRED_CAPABILITY, [context.getHandler(), context.getClass()]);
    if (!capability) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw new AppError('AUTH_REQUIRED', 'Please sign in to continue.', HttpStatus.UNAUTHORIZED);
    await this.entitlements.assert(req.user.id, capability);
    return true;
  }
}

@Global()
@Module({
  providers: [EntitlementsService, CapabilityGuard],
  exports: [EntitlementsService, CapabilityGuard],
})
export class EntitlementsModule {}
