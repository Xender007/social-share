import { z } from 'zod';

export const ANALYTICS_RANGES = ['7d', '30d', '90d', '1y'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const analyticsRangeQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).default('30d'),
});

export interface MetricBreakdown {
  platform: string;
  socialAccountId: string;
  metricKey: string;
  value: number;
  approximate: boolean;
}

export interface OverviewCard {
  group: string;
  label: string;
  value: number;
  change: number | null;
  approximate: boolean;
  breakdown: MetricBreakdown[];
  footnote: string | null;
}

export interface OverviewResponse {
  range: { from: string; to: string };
  lastSyncedAt: string | null;
  cards: OverviewCard[];
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  metricKey: string;
  label: string;
  platform: string | null;
  socialAccountId: string | null;
  unit: string;
  approximate: boolean;
  isDerived: boolean;
  points: SeriesPoint[];
}

export interface AudienceResponse {
  range: { from: string; to: string };
  series: MetricSeries[];
}

export interface AccountMetricsResponse {
  socialAccountId: string;
  platform: string;
  accountName: string;
  range: { from: string; to: string };
  series: MetricSeries[];
}

export interface TopPostRow {
  postId: string;
  title: string | null;
  createdAt: string;
  totals: { views: number; likes: number; comments: number; shares: number };
  perPlatform: Array<{ platform: string; views: number | null; likes: number | null; externalUrl: string | null }>;
}

export interface TopPostsResponse {
  range: { from: string; to: string };
  items: TopPostRow[];
}

export interface MetricDefinitionView {
  key: string;
  platform: string | null;
  entity: 'ACCOUNT' | 'PUBLICATION';
  granularity: 'SNAPSHOT' | 'DAILY';
  displayName: string;
  description: string | null;
  unit: string;
  comparableGroup: string | null;
  isDerived: boolean;
}
