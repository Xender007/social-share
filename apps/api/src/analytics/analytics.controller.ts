import { Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Injectable, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  AccountMetricsResponse,
  AnalyticsRange,
  analyticsRangeQuerySchema,
  AudienceResponse,
  MetricDefinitionView,
  MetricSeries,
  OverviewCard,
  OverviewResponse,
  TopPostsResponse,
} from '@sp/contracts';
import { AppError, notFound } from '../common/errors';
import { RateLimit } from '../common/rate-limit.guard';
import { AuthUser, CurrentUser } from '../common/request-context';
import { addDays, iso } from '../common/time';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsSyncService } from './analytics-sync.service';
import { dayKey } from './analytics-providers';

const RANGE_DAYS: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

const CONTENT_GROUPS: Array<{ group: string; label: string; footnote: string }> = [
  { group: 'views', label: 'Views', footnote: 'Each platform counts a view differently.' },
  { group: 'likes', label: 'Likes & reactions', footnote: 'Includes Facebook reactions.' },
  { group: 'comments', label: 'Comments', footnote: '' },
  { group: 'shares', label: 'Shares', footnote: '' },
];

type Definition = { key: string; platformCode: string | null; displayName: string; granularity: 'SNAPSHOT' | 'DAILY'; aggregation: string; comparableGroup: string | null; unit: string; isDerived: boolean; entity: 'ACCOUNT' | 'PUBLICATION'; description: string | null };

/** Series with one value per day: last value for snapshots, sum for daily metrics. */
function toDailySeries(points: Array<{ bucketStart: Date; capturedAt: Date; value: unknown }>, granularity: 'SNAPSHOT' | 'DAILY') {
  const byDay = new Map<string, { value: number; at: number }>();
  for (const p of points) {
    const day = dayKey(p.bucketStart);
    const value = Number(p.value);
    const existing = byDay.get(day);
    if (granularity === 'DAILY') byDay.set(day, { value: (existing?.value ?? 0) + value, at: 0 });
    else if (!existing || p.bucketStart.getTime() >= existing.at) byDay.set(day, { value, at: p.bucketStart.getTime() });
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, value: v.value }));
}

@Injectable()
export class AnalyticsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private bounds(range: AnalyticsRange) {
    const to = new Date();
    const from = new Date(`${dayKey(addDays(to, -(RANGE_DAYS[range] - 1)))}T00:00:00.000Z`);
    return { from, to, label: { from: dayKey(from), to: dayKey(to) } };
  }

  private async definitions(): Promise<Definition[]> {
    const rows = await this.prisma.metricDefinition.findMany({ where: { enabled: true }, include: { platform: true } });
    return rows.map((m) => ({ key: m.key, platformCode: m.platform?.code ?? null, displayName: m.displayName, granularity: m.granularity, aggregation: m.aggregation, comparableGroup: m.comparableGroup, unit: m.unit, isDerived: m.isDerived, entity: m.entity, description: m.description }));
  }

  /** Accounts whose platform analytics capability is allowed for this user. */
  private async accounts(userId: string) {
    const { decisions } = await this.entitlements.resolveAll(userId);
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId, status: { in: ['ACTIVE', 'REAUTH_REQUIRED', 'INACTIVE'] } },
      include: { platform: true },
      orderBy: { platform: { sortOrder: 'asc' } },
    });
    const allowed = accounts.filter((a) => decisions.get(`${a.platform.code}.analytics`)?.allowed);
    if (allowed.length === 0 && ![...decisions.values()].some((d) => d.capability.endsWith('.analytics') && d.allowed)) {
      throw new AppError('CAPABILITY_DENIED', "Analytics isn't available on your account.", HttpStatus.FORBIDDEN);
    }
    return allowed;
  }

  async overview(userId: string, range: AnalyticsRange): Promise<OverviewResponse> {
    const { from, to, label } = this.bounds(range);
    const [accounts, defs] = await Promise.all([this.accounts(userId), this.definitions()]);
    const accountIds = accounts.map((a) => a.id);
    const cards: OverviewCard[] = [];

    const audienceDefs = defs.filter((d) => d.comparableGroup === 'audience_total');
    const audiencePoints = await this.prisma.accountMetricPoint.findMany({
      where: { socialAccountId: { in: accountIds }, metricKey: { in: audienceDefs.map((d) => d.key) } },
      orderBy: { bucketStart: 'asc' },
    });
    const audienceBreakdown = accounts.flatMap((account) => {
      const pts = audiencePoints.filter((p) => p.socialAccountId === account.id);
      if (pts.length === 0) return [];
      const latest = pts[pts.length - 1];
      const firstInRange = pts.find((p) => p.bucketStart >= from) ?? latest;
      return [{ platform: account.platform.code, socialAccountId: account.id, metricKey: latest.metricKey, value: Number(latest.value), change: Number(latest.value) - Number(firstInRange.value), approximate: account.platform.code === 'youtube' }];
    });
    if (audienceBreakdown.length > 0) {
      cards.push({
        group: 'audience_total',
        label: 'Total audience',
        value: audienceBreakdown.reduce((sum, b) => sum + b.value, 0),
        change: audienceBreakdown.reduce((sum, b) => sum + b.change, 0),
        approximate: audienceBreakdown.some((b) => b.approximate),
        breakdown: audienceBreakdown.map(({ change: _c, ...rest }) => rest),
        footnote: 'Followers and subscribers are counted differently by each platform. YouTube subscriber totals are rounded.',
      });
    }

    const publications = await this.prisma.publication.findMany({
      where: { socialAccountId: { in: accountIds }, status: 'PUBLISHED', publishedAt: { gte: from, lte: to } },
      select: { id: true, socialAccountId: true, platform: { select: { code: true } } },
    });
    const pubPoints = await this.latestPublicationValues(publications.map((p) => p.id));
    for (const { group, label: cardLabel, footnote } of CONTENT_GROUPS) {
      const groupKeys = new Set(defs.filter((d) => d.comparableGroup === group && d.entity === 'PUBLICATION').map((d) => d.key));
      const perAccount = new Map<string, { platform: string; value: number; metricKey: string }>();
      for (const pub of publications) {
        for (const [metricKey, value] of pubPoints.get(pub.id) ?? []) {
          if (!groupKeys.has(metricKey)) continue;
          const entry = perAccount.get(pub.socialAccountId) ?? { platform: pub.platform.code, value: 0, metricKey };
          entry.value += value;
          perAccount.set(pub.socialAccountId, entry);
        }
      }
      if (perAccount.size === 0) continue;
      const breakdown = [...perAccount.entries()].map(([socialAccountId, v]) => ({ platform: v.platform, socialAccountId, metricKey: v.metricKey, value: v.value, approximate: false }));
      cards.push({ group, label: cardLabel, value: breakdown.reduce((s, b) => s + b.value, 0), change: null, approximate: false, breakdown, footnote: footnote || null });
    }

    const lastSynced = accounts.map((a) => a.lastMetricsSyncedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    return { range: label, lastSyncedAt: lastSynced ? new Date(lastSynced).toISOString() : null, cards };
  }

  async audience(userId: string, range: AnalyticsRange): Promise<AudienceResponse> {
    const { from, label } = this.bounds(range);
    const [accounts, defs] = await Promise.all([this.accounts(userId), this.definitions()]);
    const audienceDefs = defs.filter((d) => d.comparableGroup === 'audience_total');
    const series: MetricSeries[] = [];
    for (const account of accounts) {
      const def = audienceDefs.find((d) => d.platformCode === account.platform.code);
      if (!def) continue;
      const points = await this.prisma.accountMetricPoint.findMany({ where: { socialAccountId: account.id, metricKey: def.key, bucketStart: { gte: from } }, orderBy: { bucketStart: 'asc' } });
      if (points.length === 0) continue;
      series.push({ metricKey: def.key, label: `${account.platform.name} ${def.displayName.toLowerCase()}`, platform: account.platform.code, socialAccountId: account.id, unit: def.unit, approximate: account.platform.code === 'youtube', isDerived: false, points: toDailySeries(points, 'SNAPSHOT') });
    }
    if (series.length > 1) {
      const days = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
      const last = new Map<string, number>();
      const combined = days.map((date) => {
        for (const s of series) {
          const point = s.points.find((p) => p.date === date);
          if (point) last.set(s.socialAccountId!, point.value);
        }
        return { date, value: [...last.values()].reduce((a, b) => a + b, 0) };
      });
      series.unshift({ metricKey: 'derived.audience.total', label: 'Total audience (derived)', platform: null, socialAccountId: null, unit: 'count', approximate: true, isDerived: true, points: combined });
    }
    return { range: label, series };
  }

  async account(userId: string, socialAccountId: string, range: AnalyticsRange): Promise<AccountMetricsResponse> {
    const { from, label } = this.bounds(range);
    const accounts = await this.accounts(userId);
    const account = accounts.find((a) => a.id === socialAccountId);
    if (!account) throw notFound('Account');
    const defs = (await this.definitions()).filter((d) => d.platformCode === account.platform.code && d.entity === 'ACCOUNT');
    const points = await this.prisma.accountMetricPoint.findMany({ where: { socialAccountId, bucketStart: { gte: from } }, orderBy: { bucketStart: 'asc' } });
    const series = defs
      .map((def) => ({
        metricKey: def.key,
        label: def.displayName,
        platform: account.platform.code,
        socialAccountId,
        unit: def.unit,
        approximate: def.key === 'youtube.account.subscribers_total',
        isDerived: def.isDerived,
        points: toDailySeries(points.filter((p) => p.metricKey === def.key), def.granularity),
      }))
      .filter((s) => s.points.length > 0);
    return { socialAccountId, platform: account.platform.code, accountName: account.handle ?? account.displayName, range: label, series };
  }

  async topPosts(userId: string, range: AnalyticsRange, sort: string, limit: number): Promise<TopPostsResponse> {
    const { from, label } = this.bounds(range);
    const accounts = await this.accounts(userId);
    const defs = await this.definitions();
    const groupOf = new Map(defs.filter((d) => d.entity === 'PUBLICATION').map((d) => [d.key, d.comparableGroup]));
    const posts = await this.prisma.post.findMany({
      where: { userId, createdAt: { gte: from }, publications: { some: { status: 'PUBLISHED', socialAccountId: { in: accounts.map((a) => a.id) } } } },
      include: { publications: { where: { status: 'PUBLISHED' }, include: { platform: true } } },
    });
    const latest = await this.latestPublicationValues(posts.flatMap((p) => p.publications.map((x) => x.id)));
    const rows = posts.map((post) => {
      const totals = { views: 0, likes: 0, comments: 0, shares: 0 };
      const perPlatform = post.publications.map((pub) => {
        const values = { views: null as number | null, likes: null as number | null };
        for (const [metricKey, value] of latest.get(pub.id) ?? []) {
          const group = groupOf.get(metricKey) as keyof typeof totals | null | undefined;
          if (group && group in totals) {
            totals[group] += value;
            if (group === 'views' || group === 'likes') values[group] = (values[group] ?? 0) + value;
          }
        }
        return { platform: pub.platform.code, ...values, externalUrl: pub.externalUrl };
      });
      return { postId: post.id, title: post.title ?? post.caption?.split('\n')[0]?.slice(0, 80) ?? null, createdAt: iso(post.createdAt), totals, perPlatform };
    });
    const key = (['views', 'likes', 'comments', 'shares'].includes(sort) ? sort : 'views') as keyof (typeof rows)[number]['totals'];
    rows.sort((a, b) => b.totals[key] - a.totals[key]);
    return { range: label, items: rows.slice(0, Math.min(Math.max(limit, 1), 50)) };
  }

  async postMetrics(userId: string, postId: string): Promise<{ postId: string; series: MetricSeries[] }> {
    const post = await this.prisma.post.findFirst({ where: { id: postId, userId }, include: { publications: { include: { platform: true } } } });
    if (!post) throw notFound('Post');
    const defs = await this.definitions();
    const series: MetricSeries[] = [];
    for (const pub of post.publications.filter((p) => p.status === 'PUBLISHED')) {
      const points = await this.prisma.publicationMetricPoint.findMany({ where: { publicationId: pub.id }, orderBy: { bucketStart: 'asc' } });
      for (const def of defs.filter((d) => d.platformCode === pub.platform.code && d.entity === 'PUBLICATION')) {
        const pts = points.filter((p) => p.metricKey === def.key);
        if (pts.length === 0) continue;
        series.push({ metricKey: def.key, label: `${pub.platform.name} ${def.displayName.toLowerCase()}`, platform: pub.platform.code, socialAccountId: pub.socialAccountId, unit: def.unit, approximate: false, isDerived: false, points: toDailySeries(pts, 'SNAPSHOT') });
      }
    }
    return { postId, series };
  }

  async metrics(): Promise<MetricDefinitionView[]> {
    return (await this.definitions()).map((d) => ({ key: d.key, platform: d.platformCode, entity: d.entity, granularity: d.granularity, displayName: d.displayName, description: d.description, unit: d.unit, comparableGroup: d.comparableGroup, isDerived: d.isDerived }));
  }

  /** Latest snapshot value per (publication, metric). */
  private async latestPublicationValues(publicationIds: string[]): Promise<Map<string, Map<string, number>>> {
    const out = new Map<string, Map<string, number>>();
    if (publicationIds.length === 0) return out;
    const points = await this.prisma.publicationMetricPoint.findMany({ where: { publicationId: { in: publicationIds } }, orderBy: { bucketStart: 'asc' } });
    for (const p of points) {
      const m = out.get(p.publicationId) ?? new Map<string, number>();
      m.set(p.metricKey, Number(p.value));
      out.set(p.publicationId, m);
    }
    return out;
  }
}

const rangePipe = new ZodValidationPipe(analyticsRangeQuerySchema);

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly query: AnalyticsQueryService,
    private readonly sync: AnalyticsSyncService,
  ) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query(rangePipe) q: { range: AnalyticsRange }): Promise<OverviewResponse> {
    return this.query.overview(user.id, q.range);
  }

  @Get('audience')
  audience(@CurrentUser() user: AuthUser, @Query(rangePipe) q: { range: AnalyticsRange }): Promise<AudienceResponse> {
    return this.query.audience(user.id, q.range);
  }

  @Get('accounts/:id')
  account(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(rangePipe) q: { range: AnalyticsRange }): Promise<AccountMetricsResponse> {
    return this.query.account(user.id, id, q.range);
  }

  @Get('posts')
  posts(
    @CurrentUser() user: AuthUser,
    @Query('range') range: AnalyticsRange | undefined,
    @Query('sort') sort: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<TopPostsResponse> {
    const parsed = analyticsRangeQuerySchema.parse({ range });
    return this.query.topPosts(user.id, parsed.range, sort ?? 'views', limit);
  }

  @Get('posts/:id')
  post(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.postMetrics(user.id, id);
  }

  @Get('metrics')
  metrics(): Promise<MetricDefinitionView[]> {
    return this.query.metrics();
  }

  @Post('sync')
  @HttpCode(200)
  @RateLimit({ bucket: 'analytics-sync', limit: 6, windowMs: 15 * 60_000 })
  async syncNow(@CurrentUser() user: AuthUser): Promise<{ accounts: number; syncedAt: string }> {
    const result = await this.sync.syncUser(user.id);
    return { ...result, syncedAt: new Date().toISOString() };
  }
}
