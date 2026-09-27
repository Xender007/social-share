import { allCapabilityKeys, EntitlementSnapshot, resolveCapability } from './resolver';

const P = { id: 'p-ig', code: 'instagram', name: 'Instagram', enabled: true };
const F_PUBLISH = { id: 'f-publish', code: 'publish', name: 'Publishing', scope: 'PLATFORM' as const, enabled: true };
const F_SHARE = { id: 'f-share', code: 'android_share', name: 'Android share', scope: 'GLOBAL' as const, enabled: true };

type Overrides = {
  killSwitch?: 'pair' | 'platform' | 'feature' | 'inactive';
  platformEnabled?: boolean;
  featureEnabled?: boolean;
  platformFeatureEnabled?: boolean | 'missing';
  access?: 'ALLOW' | 'DENY' | 'none' | 'wildcardAllow+specificDeny';
  override?: 'ALLOW' | 'DENY' | 'expiredDeny' | 'wildcardDeny+specificAllow';
  userStatus?: 'ACTIVE' | 'SUSPENDED';
  accessLevelEnabled?: boolean;
};

function snapshot(o: Overrides = {}): EntitlementSnapshot {
  const now = new Date('2026-09-15T10:00:00Z');
  const killSwitches: EntitlementSnapshot['killSwitches'] = [];
  if (o.killSwitch === 'pair') killSwitches.push({ platformId: P.id, featureId: F_PUBLISH.id, active: true });
  if (o.killSwitch === 'platform') killSwitches.push({ platformId: P.id, featureId: null, active: true });
  if (o.killSwitch === 'feature') killSwitches.push({ platformId: null, featureId: F_PUBLISH.id, active: true });
  if (o.killSwitch === 'inactive') killSwitches.push({ platformId: P.id, featureId: F_PUBLISH.id, active: false });

  const accessLevelCapabilities: EntitlementSnapshot['accessLevelCapabilities'] = [];
  const access = o.access ?? 'ALLOW';
  if (access === 'ALLOW' || access === 'DENY') {
    accessLevelCapabilities.push({ platformId: P.id, featureId: F_PUBLISH.id, allowed: access === 'ALLOW' });
  }
  if (access === 'wildcardAllow+specificDeny') {
    accessLevelCapabilities.push({ platformId: null, featureId: F_PUBLISH.id, allowed: true });
    accessLevelCapabilities.push({ platformId: P.id, featureId: F_PUBLISH.id, allowed: false });
  }
  accessLevelCapabilities.push({ platformId: null, featureId: F_SHARE.id, allowed: true });

  const overrides: EntitlementSnapshot['overrides'] = [];
  if (o.override === 'ALLOW' || o.override === 'DENY') {
    overrides.push({ platformId: P.id, featureId: F_PUBLISH.id, effect: o.override, expiresAt: null });
  }
  if (o.override === 'expiredDeny') {
    overrides.push({ platformId: P.id, featureId: F_PUBLISH.id, effect: 'DENY', expiresAt: new Date('2026-09-01T00:00:00Z') });
  }
  if (o.override === 'wildcardDeny+specificAllow') {
    overrides.push({ platformId: null, featureId: F_PUBLISH.id, effect: 'DENY', expiresAt: null });
    overrides.push({ platformId: P.id, featureId: F_PUBLISH.id, effect: 'ALLOW', expiresAt: null });
  }

  return {
    now,
    user: {
      id: 'u1',
      status: o.userStatus ?? 'ACTIVE',
      accessLevelId: 'al-owner',
      accessLevelCode: 'OWNER',
      accessLevelEnabled: o.accessLevelEnabled ?? true,
    },
    platforms: [{ ...P, enabled: o.platformEnabled ?? true }],
    features: [{ ...F_PUBLISH, enabled: o.featureEnabled ?? true }, F_SHARE],
    platformFeatures:
      o.platformFeatureEnabled === 'missing'
        ? []
        : [{ platformId: P.id, featureId: F_PUBLISH.id, enabled: o.platformFeatureEnabled ?? true }],
    accessLevelCapabilities,
    overrides,
    killSwitches,
  };
}

describe('resolveCapability — blueprint §10.6 matrix', () => {
  const cases: Array<[number, Overrides, boolean, string]> = [
    [1, {}, true, 'ACCESS_LEVEL'],
    [2, { platformEnabled: false, override: 'ALLOW' }, false, 'PLATFORM_DISABLED'],
    [3, { featureEnabled: false, override: 'ALLOW' }, false, 'FEATURE_DISABLED'],
    [4, { platformFeatureEnabled: false, override: 'ALLOW' }, false, 'PLATFORM_FEATURE_DISABLED'],
    [5, { access: 'DENY' }, false, 'ACCESS_LEVEL'],
    [6, { access: 'DENY', override: 'ALLOW' }, true, 'USER_OVERRIDE'],
    [7, { override: 'DENY' }, false, 'USER_OVERRIDE'],
    [8, { killSwitch: 'pair', override: 'ALLOW' }, false, 'KILL_SWITCH'],
    [9, { killSwitch: 'platform', override: 'ALLOW' }, false, 'KILL_SWITCH'],
    [10, { killSwitch: 'feature', override: 'ALLOW' }, false, 'KILL_SWITCH'],
    [11, { killSwitch: 'inactive' }, true, 'ACCESS_LEVEL'],
    [12, { access: 'none' }, false, 'DEFAULT_DENY'],
    [13, { access: 'wildcardAllow+specificDeny' }, false, 'ACCESS_LEVEL'],
    [14, { override: 'expiredDeny' }, true, 'ACCESS_LEVEL'],
    [15, { override: 'wildcardDeny+specificAllow' }, true, 'USER_OVERRIDE'],
    [16, { userStatus: 'SUSPENDED', override: 'ALLOW' }, false, 'USER_INACTIVE'],
  ];

  it.each(cases)('row %i', (_row, overrides, allowed, reason) => {
    const decision = resolveCapability(snapshot(overrides), 'instagram.publish');
    expect(decision.allowed).toBe(allowed);
    expect(decision.reason).toBe(reason);
    expect(decision.trace.length).toBeGreaterThan(0);
  });

  it('row 17: global feature resolves without a platform', () => {
    const decision = resolveCapability(snapshot(), 'global.android_share');
    expect(decision).toMatchObject({ allowed: true, reason: 'ACCESS_LEVEL' });
  });

  it('row 18: unknown capability is denied', () => {
    expect(resolveCapability(snapshot(), 'tiktok.publish').reason).toBe('UNKNOWN_CAPABILITY');
    expect(resolveCapability(snapshot(), 'instagram.teleport').reason).toBe('UNKNOWN_CAPABILITY');
    expect(resolveCapability(snapshot(), 'nonsense').reason).toBe('UNKNOWN_CAPABILITY');
  });

  it('rejects scope mismatches', () => {
    expect(resolveCapability(snapshot(), 'global.publish').reason).toBe('UNKNOWN_CAPABILITY');
    expect(resolveCapability(snapshot(), 'instagram.android_share').reason).toBe('UNKNOWN_CAPABILITY');
  });

  it('a disabled access level denies even with defaults', () => {
    expect(resolveCapability(snapshot({ accessLevelEnabled: false }), 'instagram.publish').reason).toBe('ACCESS_LEVEL_DISABLED');
  });

  it('a missing platform_features row denies', () => {
    expect(resolveCapability(snapshot({ platformFeatureEnabled: 'missing' }), 'instagram.publish').reason).toBe(
      'PLATFORM_FEATURE_DISABLED',
    );
  });

  it('kill switch wins over a suspended user (reason is the kill switch)', () => {
    expect(resolveCapability(snapshot({ killSwitch: 'platform', userStatus: 'SUSPENDED' }), 'instagram.publish').reason).toBe(
      'KILL_SWITCH',
    );
  });

  it('lists every capability key', () => {
    expect(allCapabilityKeys(snapshot()).sort()).toEqual(['global.android_share', 'instagram.publish']);
  });
});
