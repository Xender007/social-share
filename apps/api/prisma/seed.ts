import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';
import { SETTING_DEFAULTS } from '../src/settings/settings.service';
import { ACCESS_DEFAULTS, ACCESS_LEVELS, FEATURES, METRICS, PLATFORMS } from './catalog';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function main() {
  // Seeds are create-only for anything an admin can change later, so re-running never clobbers remote config.
  const levels = new Map<string, string>();
  for (const level of ACCESS_LEVELS) {
    const row = await prisma.accessLevel.upsert({ where: { code: level.code }, create: level, update: { name: level.name, priority: level.priority } });
    levels.set(level.code, row.id);
  }

  const features = new Map<string, string>();
  for (const f of FEATURES) {
    const row = await prisma.feature.upsert({
      where: { code: f.code },
      create: { code: f.code, name: f.name, description: f.description, scope: f.scope, enabled: f.enabled },
      update: { name: f.name, description: f.description, scope: f.scope },
    });
    features.set(f.code, row.id);
  }

  for (const p of PLATFORMS) {
    const platform = await prisma.platform.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, provider: p.provider, enabled: true, sortOrder: p.sortOrder, config: json(p.config) },
      update: { name: p.name, provider: p.provider },
    });
    for (const f of FEATURES.filter((x) => x.scope === 'PLATFORM')) {
      const on = ['connect', 'publish', 'analytics'].includes(f.code);
      const config = f.code === 'publish' ? json(p.publish) : json({});
      await prisma.platformFeature.upsert({
        where: { platformId_featureId: { platformId: platform.id, featureId: features.get(f.code)! } },
        create: { platformId: platform.id, featureId: features.get(f.code)!, enabled: on, config },
        update: {},
      });
    }
  }

  for (const [levelCode, codes] of Object.entries(ACCESS_DEFAULTS)) {
    const accessLevelId = levels.get(levelCode)!;
    for (const code of codes) {
      const featureId = features.get(code)!;
      const exists = await prisma.accessLevelCapability.findFirst({ where: { accessLevelId, featureId, platformId: null } });
      if (!exists) await prisma.accessLevelCapability.create({ data: { accessLevelId, featureId, platformId: null, allowed: true } });
    }
  }

  const platformIds = new Map((await prisma.platform.findMany()).map((p) => [p.code, p.id]));
  for (const m of METRICS) {
    const data = {
      platformId: m.platform ? platformIds.get(m.platform)! : null,
      entity: m.entity,
      granularity: m.granularity,
      displayName: m.displayName,
      description: m.description ?? null,
      unit: m.unit ?? 'count',
      aggregation: m.aggregation,
      providerMetric: m.providerMetric,
      comparableGroup: m.comparableGroup,
      isDerived: m.isDerived ?? false,
    };
    await prisma.metricDefinition.upsert({ where: { key: m.key }, create: { key: m.key, ...data }, update: data });
  }

  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: json(value) }, update: {} });
  }

  console.log(`Seeded ${ACCESS_LEVELS.length} access levels, ${FEATURES.length} features, ${PLATFORMS.length} platforms, ${METRICS.length} metrics.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
