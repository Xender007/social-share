/**
 * Pure capability resolution (§10.3). No I/O: everything needed is in the snapshot,
 * so the full decision table is unit-testable.
 */

export type DecisionReason =
  | 'KILL_SWITCH'
  | 'USER_INACTIVE'
  | 'FEATURE_DISABLED'
  | 'PLATFORM_DISABLED'
  | 'PLATFORM_FEATURE_DISABLED'
  | 'ACCESS_LEVEL_DISABLED'
  | 'USER_OVERRIDE'
  | 'ACCESS_LEVEL'
  | 'DEFAULT_DENY'
  | 'UNKNOWN_CAPABILITY';

export interface Decision {
  capability: string;
  allowed: boolean;
  reason: DecisionReason;
  trace: string[];
}

export interface EntitlementSnapshot {
  now: Date;
  user: {
    id: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    accessLevelId: string;
    accessLevelCode: string;
    accessLevelEnabled: boolean;
  };
  platforms: Array<{ id: string; code: string; name: string; enabled: boolean }>;
  features: Array<{ id: string; code: string; name: string; scope: 'GLOBAL' | 'PLATFORM'; enabled: boolean }>;
  platformFeatures: Array<{ platformId: string; featureId: string; enabled: boolean }>;
  accessLevelCapabilities: Array<{ platformId: string | null; featureId: string; allowed: boolean }>;
  overrides: Array<{ platformId: string | null; featureId: string; effect: 'ALLOW' | 'DENY'; expiresAt: Date | null }>;
  killSwitches: Array<{ platformId: string | null; featureId: string | null; active: boolean }>;
}

export function parseCapability(capability: string): { scope: string; feature: string } | null {
  const dot = capability.indexOf('.');
  if (dot <= 0 || dot === capability.length - 1) return null;
  return { scope: capability.slice(0, dot), feature: capability.slice(dot + 1) };
}

export function resolveCapability(s: EntitlementSnapshot, capability: string): Decision {
  const trace: string[] = [];
  const decide = (allowed: boolean, reason: DecisionReason, note: string): Decision => {
    trace.push(`${allowed ? 'ALLOW' : 'DENY'}: ${note}`);
    return { capability, allowed, reason, trace };
  };

  const parsed = parseCapability(capability);
  const feature = parsed ? s.features.find((f) => f.code === parsed.feature) : undefined;
  if (!parsed || !feature) return decide(false, 'UNKNOWN_CAPABILITY', `"${capability}" is not a known capability`);

  const isGlobal = parsed.scope === 'global';
  if (isGlobal !== (feature.scope === 'GLOBAL')) {
    return decide(false, 'UNKNOWN_CAPABILITY', `feature "${feature.code}" is ${feature.scope.toLowerCase()}-scoped`);
  }
  const platform = isGlobal ? undefined : s.platforms.find((p) => p.code === parsed.scope);
  if (!isGlobal && !platform) return decide(false, 'UNKNOWN_CAPABILITY', `platform "${parsed.scope}" does not exist`);

  // 1. Kill switches beat everything.
  const killed = s.killSwitches.find(
    (k) =>
      k.active &&
      ((k.platformId !== null && k.platformId === platform?.id && (k.featureId === null || k.featureId === feature.id)) ||
        (k.platformId === null && k.featureId === feature.id)),
  );
  if (killed) return decide(false, 'KILL_SWITCH', 'an active kill switch covers this capability');
  trace.push('no active kill switch');

  // 2. User must be active.
  if (s.user.status !== 'ACTIVE') return decide(false, 'USER_INACTIVE', `user status is ${s.user.status}`);
  trace.push('user is active');

  // 3. Feature globally enabled.
  if (!feature.enabled) return decide(false, 'FEATURE_DISABLED', `feature "${feature.code}" is disabled`);
  trace.push(`feature "${feature.code}" is enabled`);

  // 4. Platform enabled and platform-feature enabled.
  if (platform) {
    if (!platform.enabled) return decide(false, 'PLATFORM_DISABLED', `platform "${platform.code}" is disabled`);
    trace.push(`platform "${platform.code}" is enabled`);
    const pf = s.platformFeatures.find((x) => x.platformId === platform.id && x.featureId === feature.id);
    if (!pf || !pf.enabled) {
      return decide(false, 'PLATFORM_FEATURE_DISABLED', `"${feature.code}" is not enabled on ${platform.code}`);
    }
    trace.push(`"${feature.code}" is enabled on ${platform.code}`);
  }

  // 5. Access level enabled.
  if (!s.user.accessLevelEnabled) {
    return decide(false, 'ACCESS_LEVEL_DISABLED', `access level ${s.user.accessLevelCode} is disabled`);
  }

  // 6. User overrides (platform-specific beats platform-wide).
  const liveOverrides = s.overrides.filter((o) => o.featureId === feature.id && (!o.expiresAt || o.expiresAt > s.now));
  const override =
    (platform && liveOverrides.find((o) => o.platformId === platform.id)) ?? liveOverrides.find((o) => o.platformId === null);
  if (override) {
    return decide(
      override.effect === 'ALLOW',
      'USER_OVERRIDE',
      `user override (${override.platformId ? 'platform-specific' : 'all platforms'}) says ${override.effect}`,
    );
  }
  trace.push('no user override');

  // 7. Access-level defaults (platform-specific beats platform-wide).
  const caps = s.accessLevelCapabilities.filter((c) => c.featureId === feature.id);
  const cap = (platform && caps.find((c) => c.platformId === platform.id)) ?? caps.find((c) => c.platformId === null);
  if (cap) {
    return decide(
      cap.allowed,
      'ACCESS_LEVEL',
      `access level ${s.user.accessLevelCode} ${cap.allowed ? 'allows' : 'denies'} it (${cap.platformId ? 'platform-specific' : 'all platforms'})`,
    );
  }

  // 8. Nothing matched.
  return decide(false, 'DEFAULT_DENY', `access level ${s.user.accessLevelCode} has no rule for it`);
}

/** Every capability key the catalog currently defines. */
export function allCapabilityKeys(s: EntitlementSnapshot): string[] {
  const keys: string[] = [];
  for (const f of s.features) {
    if (f.scope === 'GLOBAL') keys.push(`global.${f.code}`);
    else for (const p of s.platforms) keys.push(`${p.code}.${f.code}`);
  }
  return keys;
}

/** Human-readable label used in 403 messages. */
export function capabilityLabel(s: EntitlementSnapshot, capability: string): string {
  const parsed = parseCapability(capability);
  if (!parsed) return capability;
  const feature = s.features.find((f) => f.code === parsed.feature);
  const platform = s.platforms.find((p) => p.code === parsed.scope);
  const featureName = feature?.name ?? parsed.feature;
  return platform ? `${featureName} on ${platform.name}` : featureName;
}
