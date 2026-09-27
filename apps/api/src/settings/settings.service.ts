import { Global, Injectable, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-context';
import { validationFailed } from '../common/errors';
import { toJsonValue } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';

export const SETTING_DEFAULTS = {
  transcode_policy: 'when_needed' as 'when_needed' | 'always' | 'never',
  media_retention_days: 3,
  media_orphan_days: 2,
  max_upload_bytes: 4 * 1024 ** 3,
  upload_part_size_bytes: 10 * 1024 ** 2,
  publish_max_attempts: 6,
  analytics_account_sync: '0 */4 * * *',
  analytics_recent_sync: '15 */2 * * *',
  analytics_older_sync: '30 3 * * *',
  raw_response_retention_days: 30,
  snapshot_downsample_days: 90,
  config_version: 1,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

const EDITABLE: SettingKey[] = [
  'transcode_policy',
  'media_retention_days',
  'media_orphan_days',
  'max_upload_bytes',
  'publish_max_attempts',
  'analytics_account_sync',
  'analytics_recent_sync',
  'analytics_older_sync',
  'raw_response_retention_days',
  'snapshot_downsample_days',
];

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getAll(): Promise<Settings> {
    const rows = await this.prisma.appSetting.findMany();
    const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const row of rows) if (row.key in SETTING_DEFAULTS) values[row.key] = row.value;
    return values as Settings;
  }

  async get<K extends SettingKey>(key: K): Promise<Settings[K]> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return (row?.value as Settings[K] | undefined) ?? SETTING_DEFAULTS[key];
  }

  async update(values: Record<string, unknown>, actorUserId: string, reason: string | undefined, meta: RequestMeta): Promise<Settings> {
    const before = await this.getAll();
    for (const [key, value] of Object.entries(values)) {
      if (!EDITABLE.includes(key as SettingKey)) throw validationFailed(`Setting "${key}" cannot be edited`);
      if (typeof value !== typeof SETTING_DEFAULTS[key as SettingKey]) throw validationFailed(`Setting "${key}" has the wrong type`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(values)) {
        const json = toJsonValue(value) as Prisma.InputJsonValue;
        await tx.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
      }
      await this.bumpConfigVersion(tx);
      await this.audit.record(
        {
          actorUserId,
          action: 'settings.updated',
          entityType: 'app_settings',
          oldValue: Object.fromEntries(Object.keys(values).map((k) => [k, before[k as SettingKey]])),
          newValue: values,
          reason,
          meta,
        },
        tx,
      );
    });
    return this.getAll();
  }

  /** Invalidates cached capabilities on clients (ETag on /me/capabilities includes this). */
  async bumpConfigVersion(tx?: PrismaTx): Promise<number> {
    const client = tx ?? this.prisma;
    const row = await client.appSetting.findUnique({ where: { key: 'config_version' } });
    const next = (typeof row?.value === 'number' ? row.value : SETTING_DEFAULTS.config_version) + 1;
    await client.appSetting.upsert({ where: { key: 'config_version' }, create: { key: 'config_version', value: next }, update: { value: next } });
    return next;
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
