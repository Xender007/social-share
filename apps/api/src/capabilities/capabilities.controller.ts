import { Controller, Get, Headers, Injectable, Res } from '@nestjs/common';
import type { CapabilitiesResponse, CapabilityPlatformView, PublishLimits, PublishOptionField } from '@sp/contracts';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { AuthUser, CurrentUser } from '../common/request-context';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { KillSwitchService } from '../kill-switches/kill-switch.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CapabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly killSwitches: KillSwitchService,
    private readonly settings: SettingsService,
  ) {}

  /** Resolved capabilities plus connection state (§11). The app renders this; the API still enforces every call. */
  async forUser(userId: string): Promise<CapabilitiesResponse> {
    const [{ snapshot, decisions }, user, platforms, accounts, connections, notices, configVersion] = await Promise.all([
      this.entitlements.resolveAll(userId),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { accessLevel: true } }),
      this.prisma.platform.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' }, include: { features: { include: { feature: true } } } }),
      this.prisma.socialAccount.findMany({ where: { userId, status: { not: 'DISCONNECTED' } }, orderBy: { connectedAt: 'asc' } }),
      this.prisma.providerConnection.findMany({ where: { userId, status: { not: 'DISCONNECTED' } } }),
      this.killSwitches.notices(),
      this.settings.get('config_version'),
    ]);

    const global: Record<string, boolean> = {};
    for (const feature of snapshot.features.filter((f) => f.scope === 'GLOBAL')) {
      global[feature.code] = decisions.get(`global.${feature.code}`)?.allowed ?? false;
    }

    const platformViews: CapabilityPlatformView[] = [];
    for (const platform of platforms) {
      const capabilities: Record<string, boolean> = {};
      for (const feature of snapshot.features.filter((f) => f.scope === 'PLATFORM')) {
        capabilities[feature.code] = decisions.get(`${platform.code}.${feature.code}`)?.allowed ?? false;
      }
      if (!Object.values(capabilities).some(Boolean)) continue;

      const platformAccounts = accounts.filter((a) => a.platformId === platform.id);
      const connection = connections.find((c) => platformAccounts.some((a) => a.connectionId === c.id));
      const publishConfig = (platform.features.find((pf) => pf.feature.code === 'publish')?.config ?? {}) as {
        limits?: PublishLimits;
        options?: PublishOptionField[];
      };
      const display = ((platform.config ?? {}) as { display?: { color: string; icon: string } }).display ?? { color: '#0F766E', icon: platform.code };

      platformViews.push({
        code: platform.code,
        name: platform.name,
        provider: platform.provider,
        display,
        capabilities,
        connection: {
          status: connection?.status ?? 'NOT_CONNECTED',
          connectionId: connection?.id ?? null,
          accounts: platformAccounts.map((a) => ({ id: a.id, displayName: a.displayName, handle: a.handle, avatarUrl: a.avatarUrl, status: a.status })),
        },
        publish: {
          limits: publishConfig.limits ?? { titleRequired: false, captionMaxChars: 2200 },
          options: publishConfig.options ?? [],
        },
      });
    }

    const body: Omit<CapabilitiesResponse, 'configVersion'> = {
      user: { id: user.id, email: user.email, displayName: user.displayName, accessLevel: user.accessLevel.code },
      notices,
      global,
      platforms: platformViews,
    };
    const hash = createHash('sha1').update(`${configVersion}:${JSON.stringify(body)}`).digest('hex').slice(0, 16);
    return { configVersion: `cfg-${hash}`, ...body };
  }
}

@Controller('me/capabilities')
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilitiesService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthUser,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CapabilitiesResponse | undefined> {
    const result = await this.capabilities.forUser(user.id);
    const etag = `"${result.configVersion}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return result;
  }
}
