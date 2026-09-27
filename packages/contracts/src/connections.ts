import { z } from 'zod';
import type { ConnectionStatus, ProviderKind, SocialAccountStatus } from './enums';

export interface StartConnectionResponse {
  authorizationUrl: string;
}

export interface SocialAccountView {
  id: string;
  platform: string;
  platformName: string;
  connectionId: string;
  externalAccountId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
  statusReason: string | null;
  connectedAt: string;
}

export interface ConnectionView {
  id: string;
  provider: ProviderKind;
  externalUserName: string | null;
  status: ConnectionStatus;
  lastValidatedAt: string | null;
  accessTokenExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  accounts: SocialAccountView[];
}

export const setDestinationsSchema = z.object({
  activeSocialAccountIds: z.array(z.uuid()).max(20),
});
export type SetDestinationsRequest = z.infer<typeof setDestinationsSchema>;

export const PROVIDER_SLUGS = { google: 'GOOGLE', meta: 'META' } as const satisfies Record<string, ProviderKind>;
export type ProviderSlug = keyof typeof PROVIDER_SLUGS;
