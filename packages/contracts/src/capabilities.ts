import type { ConnectionStatus, ProviderKind, SocialAccountStatus } from './enums';

export type PublishOptionField =
  | {
      key: string;
      type: 'enum';
      label: string;
      values: string[];
      valueLabels?: string[];
      default?: string;
      required?: boolean;
    }
  | { key: string; type: 'boolean'; label: string; default?: boolean; required?: boolean }
  | { key: string; type: 'integer'; label: string; default?: number; min?: number; max?: number; required?: boolean };

export interface PublishLimits {
  titleRequired: boolean;
  titleMaxChars?: number;
  captionMaxChars: number;
  maxHashtags?: number;
  maxDurationMs?: number;
}

export interface CapabilityAccountView {
  id: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
}

export interface CapabilityPlatformView {
  code: string;
  name: string;
  provider: ProviderKind;
  display: { color: string; icon: string };
  capabilities: Record<string, boolean>;
  connection: {
    status: ConnectionStatus | 'NOT_CONNECTED';
    connectionId: string | null;
    accounts: CapabilityAccountView[];
  };
  publish: {
    limits: PublishLimits;
    options: PublishOptionField[];
  };
}

export interface CapabilityNotice {
  level: 'info' | 'warning' | 'critical';
  code: string;
  platform?: string;
  message: string;
}

export interface CapabilitiesResponse {
  configVersion: string;
  user: { id: string; email: string; displayName: string | null; accessLevel: string };
  notices: CapabilityNotice[];
  global: Record<string, boolean>;
  platforms: CapabilityPlatformView[];
}

/** Builds a capability key: `instagram.publish` or `global.android_share`. */
export function capabilityKey(scope: string | null, feature: string): string {
  return `${scope ?? 'global'}.${feature}`;
}
