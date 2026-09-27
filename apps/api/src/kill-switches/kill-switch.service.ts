import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import type { CapabilityNotice, KillSwitchView } from '@sp/contracts';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound, validationFailed } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { isoOrNull } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

type KillSwitchWithRefs = {
  id: string;
  active: boolean;
  pauseQueuedJobs: boolean;
  reason: string;
  activatedAt: Date;
  deactivatedAt: Date | null;
  platform: { code: string; name: string } | null;
  feature: { code: string; name: string } | null;
};

const PAUSABLE = ['QUEUED', 'RETRY_SCHEDULED', 'WAITING_PROVIDER'] as const;

@Injectable()
export class KillSwitchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** True when an active kill switch covers platform × feature (§27.1). */
  async blocks(platformCode: string, featureCode: string): Promise<boolean> {
    const count = await this.prisma.killSwitch.count({
      where: {
        active: true,
        OR: [
          { platform: { code: platformCode }, feature: { code: featureCode } },
          { platform: { code: platformCode }, featureId: null },
          { platformId: null, feature: { code: featureCode } },
        ],
      },
    });
    return count > 0;
  }

  async list(): Promise<KillSwitchView[]> {
    const rows = await this.prisma.killSwitch.findMany({
      orderBy: [{ active: 'desc' }, { activatedAt: 'desc' }],
      take: 100,
      include: { platform: true, feature: true },
    });
    return rows.map(toView);
  }

  async notices(): Promise<CapabilityNotice[]> {
    const rows = await this.prisma.killSwitch.findMany({ where: { active: true }, include: { platform: true, feature: true } });
    return rows.map((k) => ({
      level: 'warning' as const,
      code: 'KILL_SWITCH',
      platform: k.platform?.code,
      message: `${[k.feature?.name, k.platform ? `on ${k.platform.name}` : null].filter(Boolean).join(' ') || 'This feature'} is paused: ${k.reason}`,
    }));
  }

  async activate(
    input: { platformCode?: string; featureCode?: string; pauseQueuedJobs: boolean; reason: string },
    actorUserId: string,
    meta: RequestMeta,
  ): Promise<KillSwitchView> {
    const platform = input.platformCode ? await this.prisma.platform.findUnique({ where: { code: input.platformCode } }) : null;
    const feature = input.featureCode ? await this.prisma.feature.findUnique({ where: { code: input.featureCode } }) : null;
    if (input.platformCode && !platform) throw validationFailed(`Unknown platform ${input.platformCode}`);
    if (input.featureCode && !feature) throw validationFailed(`Unknown feature ${input.featureCode}`);

    const existing = await this.prisma.killSwitch.findFirst({ where: { active: true, platformId: platform?.id ?? null, featureId: feature?.id ?? null } });
    if (existing) throw new AppError('ACTION_NOT_ALLOWED', 'A kill switch for this scope is already active.', HttpStatus.CONFLICT);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.killSwitch.create({
        data: { platformId: platform?.id ?? null, featureId: feature?.id ?? null, pauseQueuedJobs: input.pauseQueuedJobs, reason: input.reason, activatedById: actorUserId },
        include: { platform: true, feature: true },
      });
      // Only publishing work can be paused; IN_PROGRESS steps finish and the runner pauses them afterwards.
      if (input.pauseQueuedJobs && (!feature || feature.code === 'publish')) {
        await tx.publication.updateMany({
          where: { status: { in: [...PAUSABLE] }, ...(platform ? { platformId: platform.id } : {}) },
          data: { status: 'PAUSED', errorCode: 'KILL_SWITCH', version: { increment: 1 } },
        });
      }
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record({ actorUserId, action: 'kill_switch.activated', entityType: 'kill_switch', entityId: created.id, newValue: toView(created), reason: input.reason, meta }, tx);
      return created;
    });
    return toView(row);
  }

  async deactivate(id: string, actorUserId: string, reason: string | undefined, meta: RequestMeta): Promise<{ view: KillSwitchView; resumedPublicationIds: string[] }> {
    const existing = await this.prisma.killSwitch.findUnique({ where: { id }, include: { platform: true, feature: true } });
    if (!existing) throw notFound('Kill switch');
    if (!existing.active) throw new AppError('ACTION_NOT_ALLOWED', 'This kill switch is already inactive.', HttpStatus.CONFLICT);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.killSwitch.update({ where: { id }, data: { active: false, deactivatedAt: new Date() }, include: { platform: true, feature: true } });
      let resumedPublicationIds: string[] = [];
      if (!existing.feature || existing.feature.code === 'publish') {
        const paused = await tx.publication.findMany({
          where: { status: 'PAUSED', ...(existing.platformId ? { platformId: existing.platformId } : {}) },
          select: { id: true, platform: { select: { code: true } } },
        });
        // Keep publications paused if another active switch still covers them.
        const stillBlocked = new Set<string>();
        for (const p of paused) {
          const other = await tx.killSwitch.count({
            where: {
              active: true,
              id: { not: id },
              OR: [{ platform: { code: p.platform.code }, feature: { code: 'publish' } }, { platform: { code: p.platform.code }, featureId: null }, { platformId: null, feature: { code: 'publish' } }],
            },
          });
          if (other > 0) stillBlocked.add(p.id);
        }
        resumedPublicationIds = paused.map((p) => p.id).filter((pid) => !stillBlocked.has(pid));
        if (resumedPublicationIds.length > 0) {
          await tx.publication.updateMany({ where: { id: { in: resumedPublicationIds } }, data: { status: 'QUEUED', errorCode: null, nextAttemptAt: null, version: { increment: 1 } } });
        }
      }
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record({ actorUserId, action: 'kill_switch.deactivated', entityType: 'kill_switch', entityId: id, oldValue: toView(existing), newValue: toView(updated), reason, meta }, tx);
      return { view: toView(updated), resumedPublicationIds };
    });
  }
}

function toView(k: KillSwitchWithRefs): KillSwitchView {
  return {
    id: k.id,
    platformCode: k.platform?.code ?? null,
    featureCode: k.feature?.code ?? null,
    active: k.active,
    pauseQueuedJobs: k.pauseQueuedJobs,
    reason: k.reason,
    activatedAt: k.activatedAt.toISOString(),
    deactivatedAt: isoOrNull(k.deactivatedAt),
  };
}

@Global()
@Module({ providers: [KillSwitchService], exports: [KillSwitchService] })
export class KillSwitchModule {}
