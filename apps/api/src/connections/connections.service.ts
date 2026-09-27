import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ConnectionView, SocialAccountView, StartConnectionResponse } from '@sp/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { actionNotAllowed, AppError, notFound } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { addMinutes, iso, isoOrNull, toJsonValue } from '../common/time';
import { AppConfig } from '../config/app-config';
import { TokenCipher, tokenAad } from '../crypto/token-cipher';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PublicationRunner } from '../publishing/publication-runner.service';
import { PublicationRepository, publicationInclude } from '../publishing/publication.repository';
import { PublishingEvents } from '../publishing/publishing-events.service';
import { resolveCapability } from '../entitlements/resolver';
import { SettingsService } from '../settings/settings.service';
import { AuthProviderRegistry, ProviderAuthRevokedError, SocialAuthProvider } from './auth-providers';

const STATE_TTL_MINUTES = 10;

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: AuthProviderRegistry,
    private readonly cipher: TokenCipher,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly repo: PublicationRepository,
    private readonly runner: PublicationRunner,
    private readonly events: PublishingEvents,
    private readonly config: AppConfig,
  ) {}

  async start(userId: string, slug: string): Promise<StartConnectionResponse> {
    const provider = this.provider(slug);
    const { snapshot } = await this.entitlements.resolveAll(userId);
    if (!provider.platformCodes.some((code) => resolveCapability(snapshot, `${code}.connect`).allowed)) {
      await this.entitlements.assert(userId, `${provider.platformCodes[0]}.connect`, snapshot);
    }

    const state = randomBytes(24).toString('base64url');
    const codeVerifier = provider.usesPkce ? randomBytes(48).toString('base64url') : undefined;
    const codeChallenge = codeVerifier ? createHash('sha256').update(codeVerifier).digest('base64url') : undefined;
    await this.prisma.oAuthState.create({
      data: { state, userId, provider: provider.kind, codeVerifier: codeVerifier ?? null, platformCodes: provider.platformCodes, expiresAt: addMinutes(new Date(), STATE_TTL_MINUTES) },
    });
    return { authorizationUrl: provider.buildAuthorizationUrl({ state, codeChallenge, redirectUri: this.providers.redirectUri(slug) }) };
  }

  /** Handles the provider redirect and returns the app deep link to send the browser to. */
  async callback(slug: string, query: { code?: string; state?: string; error?: string }, meta: RequestMeta): Promise<string> {
    const provider = this.providers.bySlug(slug);
    const fail = (code: string) => this.deepLink({ status: 'error', provider: slug, code });
    if (!provider || !query.state) return fail('OAUTH_STATE_INVALID');

    const row = await this.prisma.oAuthState.findUnique({ where: { state: query.state } });
    if (!row || row.provider !== provider.kind || row.expiresAt < new Date()) return fail('OAUTH_STATE_INVALID');
    const claimed = await this.prisma.oAuthState.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) return fail('OAUTH_STATE_INVALID');
    if (query.error || !query.code) return fail(query.error === 'access_denied' ? 'ACCESS_DENIED' : 'OAUTH_FAILED');

    try {
      const tokens = await provider.exchangeCode({ code: query.code, codeVerifier: row.codeVerifier ?? undefined, redirectUri: this.providers.redirectUri(slug) });
      const destinations = await provider.discoverDestinations(tokens);
      const result = await this.saveConnection(row.userId, provider, tokens, destinations, meta);
      return this.deepLink({ status: 'success', provider: slug, connectionId: result.connectionId, needsChoice: String(result.needsChoice) });
    } catch (error) {
      this.logger.warn(`OAuth callback for ${slug} failed: ${(error as Error).message}`);
      return fail(error instanceof ProviderAuthRevokedError ? 'ACCESS_DENIED' : 'OAUTH_FAILED');
    }
  }

  private async saveConnection(
    userId: string,
    provider: SocialAuthProvider,
    tokens: Awaited<ReturnType<SocialAuthProvider['exchangeCode']>>,
    destinations: Awaited<ReturnType<SocialAuthProvider['discoverDestinations']>>,
    meta: RequestMeta,
  ): Promise<{ connectionId: string; needsChoice: boolean }> {
    const existing = await this.prisma.providerConnection.findUnique({
      where: { userId_provider_externalUserId: { userId, provider: provider.kind, externalUserId: tokens.externalUserId } },
    });
    const connectionId = existing?.id ?? randomUUID();
    const access = this.cipher.encrypt(tokens.accessToken, tokenAad('provider_connections', connectionId, 'access_token_enc'));
    const refresh = tokens.refreshToken ? this.cipher.encrypt(tokens.refreshToken, tokenAad('provider_connections', connectionId, 'refresh_token_enc')) : null;
    const platforms = await this.prisma.platform.findMany({ where: { code: { in: provider.platformCodes } } });
    let needsChoice = false;
    const reconnectedAccountIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const connectionData = {
        externalUserName: tokens.externalUserName ?? null,
        scopes: tokens.scopes,
        accessTokenEnc: access.data,
        tokenKeyVersion: access.keyVersion,
        accessTokenExpiresAt: tokens.expiresAt ?? null,
        status: 'CONNECTED' as const,
        lastValidatedAt: new Date(),
        lastRefreshedAt: new Date(),
        lastError: null,
        ...(refresh ? { refreshTokenEnc: refresh.data } : {}),
      };
      if (existing) await tx.providerConnection.update({ where: { id: connectionId }, data: connectionData });
      else await tx.providerConnection.create({ data: { id: connectionId, userId, provider: provider.kind, externalUserId: tokens.externalUserId, ...connectionData } });

      const seen = new Set<string>();
      for (const platform of platforms) {
        const candidates = destinations.filter((d) => d.platformCode === platform.code);
        const eligible = candidates.filter((d) => d.eligible);
        const otherActive = await tx.socialAccount.findFirst({ where: { userId, platformId: platform.id, status: 'ACTIVE', connectionId: { not: connectionId } } });
        if (eligible.length > 1) needsChoice = true;

        for (const dest of candidates) {
          const prior = await tx.socialAccount.findUnique({ where: { userId_platformId_externalAccountId: { userId, platformId: platform.id, externalAccountId: dest.externalAccountId } } });
          const accountId = prior?.id ?? randomUUID();
          seen.add(accountId);
          const token = dest.destinationToken ? this.cipher.encrypt(dest.destinationToken, tokenAad('social_accounts', accountId, 'destination_token_enc')) : null;

          let status: 'ACTIVE' | 'INACTIVE' | 'NOT_ELIGIBLE';
          if (!dest.eligible) status = 'NOT_ELIGIBLE';
          else if (prior && (prior.status === 'ACTIVE' || prior.status === 'REAUTH_REQUIRED')) status = otherActive ? 'INACTIVE' : 'ACTIVE';
          else status = eligible.length === 1 && !otherActive ? 'ACTIVE' : 'INACTIVE';
          if (prior?.status === 'REAUTH_REQUIRED' && status === 'ACTIVE') reconnectedAccountIds.push(accountId);

          const data = {
            connectionId,
            displayName: dest.displayName,
            handle: dest.handle ?? null,
            avatarUrl: dest.avatarUrl ?? null,
            destinationTokenEnc: token?.data ?? null,
            tokenKeyVersion: token?.keyVersion ?? null,
            status,
            statusReason: dest.ineligibleReason ?? null,
            metadata: toJsonValue(dest.metadata) as Prisma.InputJsonValue,
          };
          if (prior) await tx.socialAccount.update({ where: { id: accountId }, data });
          else await tx.socialAccount.create({ data: { id: accountId, userId, platformId: platform.id, externalAccountId: dest.externalAccountId, ...data } });
        }
      }
      await tx.socialAccount.updateMany({
        where: { connectionId, id: { notIn: [...seen] }, status: { not: 'DISCONNECTED' } },
        data: { status: 'INACTIVE', statusReason: 'No longer accessible with this login' },
      });
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record(
        { actorUserId: userId, action: existing ? 'connection.reconnected' : 'connection.created', entityType: 'provider_connection', entityId: connectionId, newValue: { provider: provider.kind, destinations: destinations.map((d) => ({ platform: d.platformCode, name: d.displayName, eligible: d.eligible })) }, meta },
        tx,
      );
    });

    await this.resumeAuthBlockedPublications(reconnectedAccountIds);
    return { connectionId, needsChoice };
  }

  /** After a successful reconnect, publications blocked on auth go back to the queue (§13.5). */
  private async resumeAuthBlockedPublications(socialAccountIds: string[]): Promise<void> {
    if (socialAccountIds.length === 0) return;
    const blocked = await this.prisma.publication.findMany({
      where: { socialAccountId: { in: socialAccountIds }, status: 'NEEDS_USER_ACTION', errorCategory: 'AUTH' },
      include: publicationInclude,
    });
    for (const pub of blocked) {
      const { pub: updated } = await this.repo.transition(pub, 'QUEUED', { errorCategory: null, errorCode: null, errorMessage: null });
      await this.runner.enqueueRun(updated.platform.code, updated.id);
    }
  }

  async list(userId: string): Promise<ConnectionView[]> {
    const rows = await this.prisma.providerConnection.findMany({
      where: { userId, status: { not: 'DISCONNECTED' } },
      include: { socialAccounts: { include: { platform: true }, where: { status: { not: 'DISCONNECTED' } }, orderBy: { connectedAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      provider: c.provider,
      externalUserName: c.externalUserName,
      status: c.status,
      lastValidatedAt: isoOrNull(c.lastValidatedAt),
      accessTokenExpiresAt: isoOrNull(c.accessTokenExpiresAt),
      lastError: c.lastError,
      createdAt: iso(c.createdAt),
      accounts: c.socialAccounts.map((a) => this.accountView(a)),
    }));
  }

  async listAccounts(userId: string): Promise<SocialAccountView[]> {
    const rows = await this.prisma.socialAccount.findMany({ where: { userId, status: { not: 'DISCONNECTED' } }, include: { platform: true }, orderBy: [{ platform: { sortOrder: 'asc' } }, { connectedAt: 'asc' }] });
    return rows.map((a) => this.accountView(a));
  }

  async setDestinations(userId: string, connectionId: string, activeIds: string[], meta: RequestMeta): Promise<ConnectionView[]> {
    const connection = await this.prisma.providerConnection.findFirst({ where: { id: connectionId, userId }, include: { socialAccounts: { include: { platform: true } } } });
    if (!connection) throw notFound('Connection');
    const chosen = connection.socialAccounts.filter((a) => activeIds.includes(a.id));
    if (chosen.length !== activeIds.length) throw actionNotAllowed('Some selected accounts do not belong to this connection.');
    if (chosen.some((a) => a.status === 'NOT_ELIGIBLE')) throw new AppError('CONNECTION_NOT_ELIGIBLE', `${chosen.find((a) => a.status === 'NOT_ELIGIBLE')!.displayName} can't be used for publishing.`, HttpStatus.UNPROCESSABLE_ENTITY);

    const { snapshot } = await this.entitlements.resolveAll(userId);
    const byPlatform = new Map<string, number>();
    for (const a of chosen) byPlatform.set(a.platform.code, (byPlatform.get(a.platform.code) ?? 0) + 1);
    for (const [code, count] of byPlatform) {
      if (count > 1 && !resolveCapability(snapshot, `${code}.multi_account`).allowed) {
        throw actionNotAllowed(`Choose one ${connection.socialAccounts.find((a) => a.platform.code === code)!.platform.name} account.`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.socialAccount.updateMany({ where: { connectionId, status: 'ACTIVE', id: { notIn: activeIds } }, data: { status: 'INACTIVE' } });
      for (const account of chosen) {
        await tx.socialAccount.updateMany({ where: { userId, platformId: account.platformId, status: 'ACTIVE', id: { not: account.id } }, data: { status: 'INACTIVE' } });
        await tx.socialAccount.update({ where: { id: account.id }, data: { status: 'ACTIVE', statusReason: null } });
      }
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record({ actorUserId: userId, action: 'social_account.activated', entityType: 'provider_connection', entityId: connectionId, newValue: { activeSocialAccountIds: activeIds }, meta }, tx);
    });
    return this.list(userId);
  }

  async validateConnection(userId: string, connectionId: string): Promise<ConnectionView[]> {
    const connection = await this.prisma.providerConnection.findFirst({ where: { id: connectionId, userId } });
    if (!connection) throw notFound('Connection');
    await this.checkHealth(connection.id);
    return this.list(userId);
  }

  async disconnect(userId: string, connectionId: string, meta: RequestMeta): Promise<void> {
    const connection = await this.prisma.providerConnection.findFirst({ where: { id: connectionId, userId } });
    if (!connection) throw notFound('Connection');
    await this.prisma.$transaction(async (tx) => {
      await tx.providerConnection.update({ where: { id: connectionId }, data: { status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null } });
      await tx.socialAccount.updateMany({ where: { connectionId }, data: { status: 'DISCONNECTED', destinationTokenEnc: null, tokenKeyVersion: null } });
      await this.settings.bumpConfigVersion(tx);
      await this.audit.record({ actorUserId: userId, action: 'connection.disconnected', entityType: 'provider_connection', entityId: connectionId, oldValue: { provider: connection.provider, name: connection.externalUserName }, meta }, tx);
    });
  }

  /** Daily connections.health (§13.5) and the manual validate button. */
  async checkHealth(connectionId?: string): Promise<number> {
    const connections = await this.prisma.providerConnection.findMany({
      where: connectionId ? { id: connectionId } : { status: { in: ['CONNECTED', 'REFRESH_FAILING'] } },
    });
    for (const c of connections) {
      const provider = this.providers.byKind(c.provider);
      if (!provider || !c.accessTokenEnc) continue;
      try {
        const accessToken = this.cipher.decrypt(c.accessTokenEnc, tokenAad('provider_connections', c.id, 'access_token_enc'));
        const refreshToken = c.refreshTokenEnc ? this.cipher.decrypt(c.refreshTokenEnc, tokenAad('provider_connections', c.id, 'refresh_token_enc')) : undefined;
        const result = await provider.validate({ accessToken, refreshToken });
        if (result.valid) {
          await this.prisma.providerConnection.update({ where: { id: c.id }, data: { status: 'CONNECTED', lastValidatedAt: new Date(), lastError: null } });
        } else {
          await this.prisma.providerConnection.update({ where: { id: c.id }, data: { status: 'REAUTH_REQUIRED', lastError: result.reason ?? 'INVALID' } });
          await this.prisma.socialAccount.updateMany({ where: { connectionId: c.id, status: 'ACTIVE' }, data: { status: 'REAUTH_REQUIRED', statusReason: 'Access expired' } });
          await this.events.connectionNeedsReauth(c.userId, provider.label);
        }
      } catch (error) {
        const failing = c.status === 'REFRESH_FAILING';
        await this.prisma.providerConnection.update({ where: { id: c.id }, data: { status: 'REFRESH_FAILING', lastError: (error as Error).message.slice(0, 200) } });
        if (failing) await this.events.connectionNeedsReauth(c.userId, provider.label);
      }
    }
    return connections.length;
  }

  private provider(slug: string): SocialAuthProvider {
    const provider = this.providers.bySlug(slug);
    if (!provider) {
      throw new AppError('VALIDATION_FAILED', this.config.isFakeProviders ? `Unknown provider ${slug}` : `${slug} is not configured on the server yet.`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return provider;
  }

  private deepLink(params: Record<string, string>): string {
    return `${this.config.env.MOBILE_DEEP_LINK_SCHEME}://connections/result?${new URLSearchParams(params)}`;
  }

  private accountView(a: Prisma.SocialAccountGetPayload<{ include: { platform: true } }>): SocialAccountView {
    return {
      id: a.id,
      platform: a.platform.code,
      platformName: a.platform.name,
      connectionId: a.connectionId,
      externalAccountId: a.externalAccountId,
      displayName: a.displayName,
      handle: a.handle,
      avatarUrl: a.avatarUrl,
      status: a.status,
      statusReason: a.statusReason,
      connectedAt: iso(a.connectedAt),
    };
  }
}
