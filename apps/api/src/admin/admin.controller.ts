import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AdminFeatureView,
  AdminOverview,
  AdminPlatformView,
  AuditLogView,
  CapabilityDecisionView,
  CreateKillSwitchRequest,
  createKillSwitchSchema,
  KillSwitchView,
  PublicationStatus,
  PUBLICATION_STATUSES,
  UpdateFeatureRequest,
  updateFeatureSchema,
  UpdatePlatformFeatureRequest,
  updatePlatformFeatureSchema,
  UpdatePlatformRequest,
  updatePlatformSchema,
  UpdateSettingsRequest,
  updateSettingsSchema,
} from '@sp/contracts';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/errors';
import { AuthUser, CurrentUser, ReqContext, RequestMeta, RequireCapability } from '../common/request-context';
import { addDays, iso, isoOrNull, toJsonValue } from '../common/time';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { Prisma } from '../generated/prisma/client';
import { JobQueueService } from '../jobs/job-queue.service';
import { KillSwitchService } from '../kill-switches/kill-switch.service';
import { NotificationsService } from '../notifications/notifications.service';
import { postViewInclude, toPublicationView } from '../posts/post-view';
import { PostsService } from '../posts/posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicationRunner } from '../publishing/publication-runner.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly killSwitches: KillSwitchService,
    private readonly jobs: JobQueueService,
    private readonly runner: PublicationRunner,
    private readonly entitlements: EntitlementsService,
    private readonly posts: PostsService,
    private readonly notifications: NotificationsService,
  ) {}

  async overview(): Promise<AdminOverview & { recentNotifications: NotificationsService['recent'] }> {
    const now = new Date();
    const [grouped, platforms, connections, queues, runs, activeKillSwitches] = await Promise.all([
      this.prisma.publication.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.platform.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.providerConnection.findMany({ where: { status: { not: 'DISCONNECTED' } } }),
      this.jobs.summaries(),
      this.prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
      this.killSwitches.list().then((all) => all.filter((k) => k.active)),
    ]);

    const platformHealth = await Promise.all(
      platforms.map(async (p) => {
        const [published24h, failed24h, published7d, failed7d] = await Promise.all([
          this.prisma.publication.count({ where: { platformId: p.id, status: 'PUBLISHED', publishedAt: { gte: addDays(now, -1) } } }),
          this.prisma.publication.count({ where: { platformId: p.id, status: { in: ['FAILED_FINAL', 'NEEDS_USER_ACTION'] }, updatedAt: { gte: addDays(now, -1) } } }),
          this.prisma.publication.count({ where: { platformId: p.id, status: 'PUBLISHED', publishedAt: { gte: addDays(now, -7) } } }),
          this.prisma.publication.count({ where: { platformId: p.id, status: { in: ['FAILED_FINAL', 'NEEDS_USER_ACTION'] }, updatedAt: { gte: addDays(now, -7) } } }),
        ]);
        const total7d = published7d + failed7d;
        return { platform: p.code, published24h, failed24h, successRate7d: total7d ? Math.round((published7d / total7d) * 100) / 100 : null };
      }),
    );

    return {
      publicationsByStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<PublicationStatus, number>>,
      platformHealth,
      connections: connections.map((c) => ({ id: c.id, provider: c.provider, status: c.status, name: c.externalUserName })),
      queues: queues.map((q) => ({ name: q.name, queued: q.queued, active: q.active, oldestQueuedSeconds: null })),
      lastSyncRuns: runs.map((r) => ({ kind: r.kind, status: r.status, startedAt: iso(r.startedAt), finishedAt: isoOrNull(r.finishedAt), error: r.error })),
      activeKillSwitches,
      recentNotifications: this.notifications.recent.slice(0, 10),
    };
  }

  async platforms(): Promise<AdminPlatformView[]> {
    const rows = await this.prisma.platform.findMany({ orderBy: { sortOrder: 'asc' }, include: { features: { include: { feature: true } } } });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      provider: p.provider,
      enabled: p.enabled,
      sortOrder: p.sortOrder,
      features: p.features
        .filter((pf) => pf.feature.scope === 'PLATFORM')
        .sort((a, b) => a.feature.code.localeCompare(b.feature.code))
        .map((pf) => ({ featureId: pf.featureId, featureCode: pf.feature.code, featureName: pf.feature.name, enabled: pf.enabled })),
    }));
  }

  async updatePlatform(id: string, body: UpdatePlatformRequest, actor: string, meta: RequestMeta): Promise<AdminPlatformView[]> {
    const before = await this.prisma.platform.findUnique({ where: { id } });
    if (!before) throw notFound('Platform');
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.platform.update({ where: { id }, data: { enabled: body.enabled, sortOrder: body.sortOrder } });
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record({ actorUserId: actor, action: 'platform.updated', entityType: 'platform', entityId: id, oldValue: { enabled: before.enabled, sortOrder: before.sortOrder }, newValue: { platformName: before.name, enabled: after.enabled, sortOrder: after.sortOrder }, reason: body.reason, meta }, tx);
    });
    return this.platforms();
  }

  async features(): Promise<AdminFeatureView[]> {
    const rows = await this.prisma.feature.findMany({ orderBy: [{ scope: 'asc' }, { code: 'asc' }] });
    return rows.map((f) => ({ id: f.id, code: f.code, name: f.name, description: f.description, scope: f.scope, enabled: f.enabled }));
  }

  async updateFeature(id: string, body: UpdateFeatureRequest, actor: string, meta: RequestMeta): Promise<AdminFeatureView[]> {
    const before = await this.prisma.feature.findUnique({ where: { id } });
    if (!before) throw notFound('Feature');
    await this.prisma.$transaction(async (tx) => {
      await tx.feature.update({ where: { id }, data: { enabled: body.enabled } });
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record({ actorUserId: actor, action: 'feature.updated', entityType: 'feature', entityId: id, oldValue: { enabled: before.enabled }, newValue: { featureName: before.name, enabled: body.enabled }, reason: body.reason, meta }, tx);
    });
    return this.features();
  }

  async updatePlatformFeature(platformId: string, featureId: string, body: UpdatePlatformFeatureRequest, actor: string, meta: RequestMeta): Promise<AdminPlatformView[]> {
    const [before, platform, feature] = await Promise.all([
      this.prisma.platformFeature.findUnique({ where: { platformId_featureId: { platformId, featureId } } }),
      this.prisma.platform.findUnique({ where: { id: platformId }, select: { name: true } }),
      this.prisma.feature.findUnique({ where: { id: featureId }, select: { name: true } }),
    ]);
    if (!platform) throw notFound('Platform');
    if (!feature) throw notFound('Feature');
    await this.prisma.$transaction(async (tx) => {
      const data = { enabled: body.enabled, ...(body.config ? { config: toJsonValue(body.config) as Prisma.InputJsonValue } : {}) };
      await tx.platformFeature.upsert({ where: { platformId_featureId: { platformId, featureId } }, create: { platformId, featureId, enabled: body.enabled ?? false, config: data.config ?? {} }, update: data });
      await this.settings.bumpConfigVersion(tx);
      // Names are stored with the entry so the audit log stays readable even if they change later.
      await this.audit.record({ actorUserId: actor, action: 'platform_feature.updated', entityType: 'platform_feature', entityId: `${platformId}:${featureId}`, oldValue: before ? { enabled: before.enabled } : null, newValue: { platformName: platform.name, featureName: feature.name, enabled: body.enabled, configChanged: Boolean(body.config) }, reason: body.reason, meta }, tx);
    });
    return this.platforms();
  }

  async deactivateKillSwitch(id: string, actor: string, reason: string | undefined, meta: RequestMeta): Promise<KillSwitchView> {
    const { view, resumedPublicationIds } = await this.killSwitches.deactivate(id, actor, reason, meta);
    const resumed = await this.prisma.publication.findMany({ where: { id: { in: resumedPublicationIds } }, include: { platform: true } });
    for (const pub of resumed) await this.runner.enqueueRun(pub.platform.code, pub.id);
    return view;
  }

  async publications(status?: PublicationStatus) {
    const rows = await this.prisma.publication.findMany({
      where: status ? { status } : { status: { in: ['NEEDS_USER_ACTION', 'UNKNOWN_OUTCOME', 'RETRY_SCHEDULED', 'FAILED_FINAL', 'PAUSED', 'IN_PROGRESS', 'WAITING_PROVIDER', 'QUEUED', 'PENDING_MEDIA'] } },
      include: { ...postViewInclude.publications.include, post: { select: { id: true, title: true, caption: true, userId: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => ({ ...toPublicationView(p), postId: p.post.id, postTitle: p.post.title ?? p.post.caption?.slice(0, 60) ?? null }));
  }

  async retryPublication(id: string, meta: RequestMeta) {
    const pub = await this.prisma.publication.findUnique({ where: { id }, include: { post: true } });
    if (!pub) throw notFound('Publication');
    return this.posts.retry(pub.post.userId, id, meta);
  }

  async connections() {
    const rows = await this.prisma.providerConnection.findMany({ include: { socialAccounts: { include: { platform: true } }, user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => ({
      id: c.id,
      provider: c.provider,
      owner: c.user.email,
      name: c.externalUserName,
      status: c.status,
      lastValidatedAt: isoOrNull(c.lastValidatedAt),
      accessTokenExpiresAt: isoOrNull(c.accessTokenExpiresAt),
      lastError: c.lastError,
      accounts: c.socialAccounts.map((a) => ({ id: a.id, platform: a.platform.code, name: a.handle ?? a.displayName, status: a.status })),
    }));
  }

  async explain(userId: string, capability: string): Promise<CapabilityDecisionView> {
    return this.entitlements.decide(userId, capability);
  }

  async auditLogs(limit: number): Promise<AuditLogView[]> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200), include: { actor: { select: { email: true } } } });
    return rows.map((r) => ({ id: String(r.id), actorEmail: r.actor?.email ?? null, action: r.action, entityType: r.entityType, entityId: r.entityId, oldValue: r.oldValue, newValue: r.newValue, reason: r.reason, createdAt: iso(r.createdAt) }));
  }
}

const deactivateSchema = z.object({ reason: z.string().max(500).optional() });
const explainQuerySchema = z.object({ capability: z.string().min(3), userId: z.uuid().optional() });

@Controller('admin')
@RequireCapability('global.admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly killSwitches: KillSwitchService,
    private readonly settings: SettingsService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('platforms')
  platforms() {
    return this.admin.platforms();
  }

  @Patch('platforms/:id')
  updatePlatform(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePlatformSchema)) body: UpdatePlatformRequest, @ReqContext() meta: RequestMeta) {
    return this.admin.updatePlatform(id, body, user.id, meta);
  }

  @Put('platforms/:id/features/:featureId')
  updatePlatformFeature(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body(new ZodValidationPipe(updatePlatformFeatureSchema)) body: UpdatePlatformFeatureRequest,
    @ReqContext() meta: RequestMeta,
  ) {
    return this.admin.updatePlatformFeature(id, featureId, body, user.id, meta);
  }

  @Get('features')
  features() {
    return this.admin.features();
  }

  @Patch('features/:id')
  updateFeature(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateFeatureSchema)) body: UpdateFeatureRequest, @ReqContext() meta: RequestMeta) {
    return this.admin.updateFeature(id, body, user.id, meta);
  }

  @Get('kill-switches')
  listKillSwitches(): Promise<KillSwitchView[]> {
    return this.killSwitches.list();
  }

  @Post('kill-switches')
  activateKillSwitch(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createKillSwitchSchema)) body: CreateKillSwitchRequest, @ReqContext() meta: RequestMeta): Promise<KillSwitchView> {
    return this.killSwitches.activate(body, user.id, meta);
  }

  @Post('kill-switches/:id/deactivate')
  @HttpCode(200)
  deactivateKillSwitch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(deactivateSchema)) body: { reason?: string }, @ReqContext() meta: RequestMeta) {
    return this.admin.deactivateKillSwitch(id, user.id, body.reason, meta);
  }

  @Get('publications')
  publications(@Query('status') status?: string) {
    const parsed = status && (PUBLICATION_STATUSES as readonly string[]).includes(status) ? (status as PublicationStatus) : undefined;
    return this.admin.publications(parsed);
  }

  @Post('publications/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseUUIDPipe) id: string, @ReqContext() meta: RequestMeta) {
    return this.admin.retryPublication(id, meta);
  }

  @Get('connections')
  connections() {
    return this.admin.connections();
  }

  @Get('capabilities/explain')
  explain(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(explainQuerySchema)) query: { capability: string; userId?: string }) {
    return this.admin.explain(query.userId ?? user.id, query.capability);
  }

  @Get('audit-logs')
  auditLogs(@Query('limit') limit?: string) {
    return this.admin.auditLogs(Number(limit ?? 50));
  }

  @Get('settings')
  getSettings() {
    return this.settings.getAll();
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(updateSettingsSchema)) body: UpdateSettingsRequest, @ReqContext() meta: RequestMeta) {
    return this.settings.update(body.values, user.id, body.reason, meta);
  }
}
