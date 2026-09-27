import { z } from 'zod';
import type { PublicationStatus } from './enums';

const reason = z.string().trim().max(500).optional();

export const updatePlatformSchema = z.object({
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  reason,
});
export type UpdatePlatformRequest = z.infer<typeof updatePlatformSchema>;

export const updateFeatureSchema = z.object({
  enabled: z.boolean(),
  reason,
});
export type UpdateFeatureRequest = z.infer<typeof updateFeatureSchema>;

export const updatePlatformFeatureSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  reason,
});
export type UpdatePlatformFeatureRequest = z.infer<typeof updatePlatformFeatureSchema>;

export const createKillSwitchSchema = z
  .object({
    platformCode: z.string().optional(),
    featureCode: z.string().optional(),
    pauseQueuedJobs: z.boolean().default(true),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.platformCode || v.featureCode, { message: 'Choose a platform, a feature, or both' });
export type CreateKillSwitchRequest = z.infer<typeof createKillSwitchSchema>;

export const updateSettingsSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  reason,
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsSchema>;

export interface AdminPlatformView {
  id: string;
  code: string;
  name: string;
  provider: string;
  enabled: boolean;
  sortOrder: number;
  features: Array<{ featureId: string; featureCode: string; featureName: string; enabled: boolean }>;
}

export interface AdminFeatureView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope: 'GLOBAL' | 'PLATFORM';
  enabled: boolean;
}

export interface KillSwitchView {
  id: string;
  platformCode: string | null;
  featureCode: string | null;
  active: boolean;
  pauseQueuedJobs: boolean;
  reason: string;
  activatedAt: string;
  deactivatedAt: string | null;
}

export interface AdminOverview {
  publicationsByStatus: Partial<Record<PublicationStatus, number>>;
  platformHealth: Array<{ platform: string; published24h: number; failed24h: number; successRate7d: number | null }>;
  connections: Array<{ id: string; provider: string; status: string; name: string | null }>;
  queues: Array<{ name: string; queued: number; active: number; oldestQueuedSeconds: number | null }>;
  lastSyncRuns: Array<{ kind: string; status: string; startedAt: string; finishedAt: string | null; error: string | null }>;
  activeKillSwitches: KillSwitchView[];
}

export interface AuditLogView {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: string;
}

export interface CapabilityDecisionView {
  capability: string;
  allowed: boolean;
  reason: string;
  trace: string[];
}
