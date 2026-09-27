import { createHash } from 'node:crypto';
import { httpJson } from '../publishers/http';
import type { ProviderCredentials } from '../publishers/types';

export interface MetricPointInput {
  entity: 'ACCOUNT' | 'PUBLICATION';
  entityId: string;
  metricKey: string;
  bucketKey: string;
  bucketStart: Date;
  value: number;
}

export interface AnalyticsContext {
  account: { id: string; externalAccountId: string; createdAt: Date; metadata: Record<string, unknown> };
  credentials(): Promise<ProviderCredentials>;
  apiVersion: string;
}

export interface PublicationRef {
  id: string;
  externalId: string;
  publishedAt: Date;
}

export interface SocialAnalyticsProvider {
  readonly platformCode: string;
  syncAccount(ctx: AnalyticsContext, range: { since: Date; until: Date }): Promise<MetricPointInput[]>;
  syncPublications(ctx: AnalyticsContext, publications: PublicationRef[]): Promise<MetricPointInput[]>;
}

const DAY = 86_400_000;
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const snapshotBucket = (d: Date) => ({ bucketKey: d.toISOString().slice(0, 13), bucketStart: new Date(`${d.toISOString().slice(0, 13)}:00:00.000Z`) });

function daysBetween(since: Date, until: Date): string[] {
  const out: string[] = [];
  for (let t = dayStart(dayKey(since)).getTime(); t <= until.getTime(); t += DAY) out.push(dayKey(new Date(t)));
  return out;
}

/** Deterministic pseudo-random numbers so simulated dashboards are stable across syncs. */
function seeded(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAKE_PROFILES: Record<string, { audienceKey: string; base: number; growth: number; daily: Array<[string, number]>; content: Array<[string, number]> }> = {
  youtube: {
    audienceKey: 'youtube.account.subscribers_total',
    base: 5200,
    growth: 14,
    daily: [['youtube.account.views', 2400], ['youtube.account.watch_minutes', 5200], ['youtube.account.likes', 160], ['youtube.account.comments', 22], ['youtube.account.shares', 18], ['youtube.account.subscribers_gained', 19], ['youtube.account.subscribers_lost', 5]],
    content: [['youtube.video.views', 3200], ['youtube.video.likes', 210], ['youtube.video.comments', 26]],
  },
  instagram: {
    audienceKey: 'instagram.account.followers_total',
    base: 10100,
    growth: 38,
    daily: [['instagram.account.reach', 5200], ['instagram.account.views', 9800]],
    content: [['instagram.reel.views', 8900], ['instagram.reel.reach', 6100], ['instagram.reel.likes', 640], ['instagram.reel.comments', 48], ['instagram.reel.shares', 95], ['instagram.reel.saves', 120]],
  },
  facebook: {
    audienceKey: 'facebook.page.followers_total',
    base: 6050,
    growth: 9,
    daily: [['facebook.page.views', 1900]],
    content: [['facebook.reel.plays', 4100], ['facebook.reel.reactions', 260], ['facebook.reel.comments', 31], ['facebook.reel.shares', 44]],
  },
};

/** Simulated analytics for PROVIDER_MODE=fake: plausible, deterministic history per account. */
export class FakeAnalyticsProvider implements SocialAnalyticsProvider {
  constructor(readonly platformCode: string) {}

  async syncAccount(ctx: AnalyticsContext, range: { since: Date; until: Date }): Promise<MetricPointInput[]> {
    const profile = FAKE_PROFILES[this.platformCode];
    if (!profile) return [];
    const points: MetricPointInput[] = [];
    const epoch = dayStart('2026-01-01').getTime();
    for (const key of daysBetween(range.since, range.until)) {
      const dayIndex = Math.floor((dayStart(key).getTime() - epoch) / DAY);
      const rand = seeded(`${ctx.account.id}:${key}`);
      const audience = Math.round(profile.base + profile.growth * dayIndex + rand() * profile.growth * 3);
      points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey: profile.audienceKey, bucketKey: `${key}T00`, bucketStart: dayStart(key), value: audience });
      const weekday = dayStart(key).getUTCDay();
      const weekendBoost = weekday === 0 || weekday === 6 ? 1.25 : 1;
      for (const [metricKey, typical] of profile.daily) {
        points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey, bucketKey: key, bucketStart: dayStart(key), value: Math.round(typical * weekendBoost * (0.6 + rand() * 0.8)) });
      }
    }
    if (this.platformCode === 'youtube') {
      const now = snapshotBucket(range.until);
      const lifetime = Math.round(410_000 + 2400 * Math.floor((range.until.getTime() - epoch) / DAY));
      points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey: 'youtube.account.views_total', ...now, value: lifetime });
    }
    return points;
  }

  async syncPublications(_ctx: AnalyticsContext, publications: PublicationRef[]): Promise<MetricPointInput[]> {
    const profile = FAKE_PROFILES[this.platformCode];
    if (!profile) return [];
    const now = new Date();
    const bucket = snapshotBucket(now);
    const points: MetricPointInput[] = [];
    for (const pub of publications) {
      const ageDays = Math.max(0, (now.getTime() - pub.publishedAt.getTime()) / DAY);
      const curve = 1 - Math.exp(-ageDays / 2.5) + Math.min(ageDays, 0.05);
      const rand = seeded(pub.id);
      const quality = 0.4 + rand() * 1.4;
      for (const [metricKey, typical] of profile.content) {
        points.push({ entity: 'PUBLICATION', entityId: pub.id, metricKey, ...bucket, value: Math.round(typical * quality * curve) });
      }
    }
    return points;
  }
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await httpJson<T & { error?: { message?: string } }>(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) throw new Error(`Analytics request failed (${res.status}): ${res.body?.error?.message ?? res.text.slice(0, 200)}`);
  return res.body;
}

/** YouTube Data API statistics + YouTube Analytics daily report (§23.3). (verify metric names) */
export class YouTubeAnalyticsProvider implements SocialAnalyticsProvider {
  readonly platformCode = 'youtube';

  async syncAccount(ctx: AnalyticsContext, range: { since: Date; until: Date }): Promise<MetricPointInput[]> {
    const { accessToken } = await ctx.credentials();
    const points: MetricPointInput[] = [];
    const channel = await getJson<{ items?: Array<{ statistics?: { subscriberCount?: string; viewCount?: string } }> }>(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(ctx.account.externalAccountId)}`,
      accessToken,
    );
    const stats = channel.items?.[0]?.statistics;
    const bucket = snapshotBucket(range.until);
    if (stats?.subscriberCount) points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey: 'youtube.account.subscribers_total', ...bucket, value: Number(stats.subscriberCount) });
    if (stats?.viewCount) points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey: 'youtube.account.views_total', ...bucket, value: Number(stats.viewCount) });

    const metrics = ['views', 'estimatedMinutesWatched', 'likes', 'comments', 'shares', 'subscribersGained', 'subscribersLost'];
    const keys = ['youtube.account.views', 'youtube.account.watch_minutes', 'youtube.account.likes', 'youtube.account.comments', 'youtube.account.shares', 'youtube.account.subscribers_gained', 'youtube.account.subscribers_lost'];
    const report = await getJson<{ rows?: Array<Array<string | number>> }>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: 'channel==MINE', startDate: dayKey(range.since), endDate: dayKey(range.until), metrics: metrics.join(','), dimensions: 'day', sort: 'day' })}`,
      accessToken,
    );
    for (const row of report.rows ?? []) {
      const day = String(row[0]);
      keys.forEach((metricKey, i) => points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey, bucketKey: day, bucketStart: dayStart(day), value: Number(row[i + 1] ?? 0) }));
    }
    return points;
  }

  async syncPublications(ctx: AnalyticsContext, publications: PublicationRef[]): Promise<MetricPointInput[]> {
    const { accessToken } = await ctx.credentials();
    const points: MetricPointInput[] = [];
    const bucket = snapshotBucket(new Date());
    for (let i = 0; i < publications.length; i += 50) {
      const batch = publications.slice(i, i + 50);
      const res = await getJson<{ items?: Array<{ id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> }>(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.map((p) => encodeURIComponent(p.externalId)).join(',')}`,
        accessToken,
      );
      for (const item of res.items ?? []) {
        const pub = batch.find((p) => p.externalId === item.id);
        if (!pub || !item.statistics) continue;
        const add = (metricKey: string, v?: string) => v !== undefined && points.push({ entity: 'PUBLICATION', entityId: pub.id, metricKey, ...bucket, value: Number(v) });
        add('youtube.video.views', item.statistics.viewCount);
        add('youtube.video.likes', item.statistics.likeCount);
        add('youtube.video.comments', item.statistics.commentCount);
      }
    }
    return points;
  }
}

/** Instagram Graph API insights (§23.3). (verify metric names for the configured API version) */
export class InstagramAnalyticsProvider implements SocialAnalyticsProvider {
  readonly platformCode = 'instagram';

  async syncAccount(ctx: AnalyticsContext, range: { since: Date; until: Date }): Promise<MetricPointInput[]> {
    const { accessToken, destinationToken } = await ctx.credentials();
    const token = destinationToken ?? accessToken;
    const base = `https://graph.facebook.com/${ctx.apiVersion}`;
    const points: MetricPointInput[] = [];
    const profile = await getJson<{ followers_count?: number }>(`${base}/${ctx.account.externalAccountId}?fields=followers_count&access_token=${encodeURIComponent(token)}`, token);
    if (profile.followers_count !== undefined) {
      points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey: 'instagram.account.followers_total', ...snapshotBucket(range.until), value: profile.followers_count });
    }
    const insights = await getJson<{ data?: Array<{ name: string; values?: Array<{ value: number; end_time: string }> }> }>(
      `${base}/${ctx.account.externalAccountId}/insights?${new URLSearchParams({ metric: 'reach', period: 'day', since: String(Math.floor(range.since.getTime() / 1000)), until: String(Math.floor(range.until.getTime() / 1000)), access_token: token })}`,
      token,
    );
    for (const metric of insights.data ?? []) {
      const metricKey = metric.name === 'reach' ? 'instagram.account.reach' : null;
      if (!metricKey) continue;
      for (const v of metric.values ?? []) {
        const day = dayKey(new Date(Date.parse(v.end_time) - DAY));
        points.push({ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey, bucketKey: day, bucketStart: dayStart(day), value: v.value });
      }
    }
    return points;
  }

  async syncPublications(ctx: AnalyticsContext, publications: PublicationRef[]): Promise<MetricPointInput[]> {
    const { accessToken, destinationToken } = await ctx.credentials();
    const token = destinationToken ?? accessToken;
    const bucket = snapshotBucket(new Date());
    const map: Record<string, string> = { views: 'instagram.reel.views', reach: 'instagram.reel.reach', likes: 'instagram.reel.likes', comments: 'instagram.reel.comments', shares: 'instagram.reel.shares', saved: 'instagram.reel.saves' };
    const points: MetricPointInput[] = [];
    for (const pub of publications) {
      const res = await getJson<{ data?: Array<{ name: string; values?: Array<{ value: number }> }> }>(
        `https://graph.facebook.com/${ctx.apiVersion}/${pub.externalId}/insights?${new URLSearchParams({ metric: Object.keys(map).join(','), access_token: token })}`,
        token,
      );
      for (const metric of res.data ?? []) {
        const metricKey = map[metric.name];
        const value = metric.values?.[0]?.value;
        if (metricKey && typeof value === 'number') points.push({ entity: 'PUBLICATION', entityId: pub.id, metricKey, ...bucket, value });
      }
    }
    return points;
  }
}

/** Facebook Page and Reel insights (§23.3). (verify metric names for the configured API version) */
export class FacebookAnalyticsProvider implements SocialAnalyticsProvider {
  readonly platformCode = 'facebook';

  async syncAccount(ctx: AnalyticsContext, range: { since: Date; until: Date }): Promise<MetricPointInput[]> {
    const { destinationToken } = await ctx.credentials();
    if (!destinationToken) return [];
    const page = await getJson<{ followers_count?: number }>(
      `https://graph.facebook.com/${ctx.apiVersion}/${ctx.account.externalAccountId}?fields=followers_count&access_token=${encodeURIComponent(destinationToken)}`,
      destinationToken,
    );
    return page.followers_count === undefined
      ? []
      : [{ entity: 'ACCOUNT', entityId: ctx.account.id, metricKey: 'facebook.page.followers_total', ...snapshotBucket(range.until), value: page.followers_count }];
  }

  async syncPublications(ctx: AnalyticsContext, publications: PublicationRef[]): Promise<MetricPointInput[]> {
    const { destinationToken } = await ctx.credentials();
    if (!destinationToken) return [];
    const bucket = snapshotBucket(new Date());
    const points: MetricPointInput[] = [];
    for (const pub of publications) {
      const res = await getJson<{ data?: Array<{ name: string; values?: Array<{ value: number | Record<string, number> }> }> }>(
        `https://graph.facebook.com/${ctx.apiVersion}/${pub.externalId}/video_insights?${new URLSearchParams({ metric: 'blue_reels_play_count,post_video_likes_by_reaction_type', access_token: destinationToken })}`,
        destinationToken,
      );
      for (const metric of res.data ?? []) {
        const raw = metric.values?.[0]?.value;
        const value = typeof raw === 'number' ? raw : raw ? Object.values(raw).reduce((a, b) => a + b, 0) : undefined;
        const metricKey = metric.name === 'blue_reels_play_count' ? 'facebook.reel.plays' : metric.name === 'post_video_likes_by_reaction_type' ? 'facebook.reel.reactions' : null;
        if (metricKey && value !== undefined) points.push({ entity: 'PUBLICATION', entityId: pub.id, metricKey, ...bucket, value });
      }
    }
    return points;
  }
}
