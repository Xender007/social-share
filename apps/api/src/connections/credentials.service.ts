import { Injectable, Logger } from '@nestjs/common';
import { TokenCipher, tokenAad } from '../crypto/token-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderError, type ProviderCredentials } from '../publishers/types';
import { AuthProviderRegistry, ProviderAuthRevokedError } from './auth-providers';

const REFRESH_MARGIN_MS = 5 * 60_000;

const reauth = () =>
  new ProviderError({ category: 'AUTH', code: 'CONNECTION_REAUTH_REQUIRED', userMessage: 'This account needs to be reconnected.', requestHadNoEffect: true });

/** The only place that turns stored ciphertext into usable provider tokens for a destination (§14.4). */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
    private readonly providers: AuthProviderRegistry,
  ) {}

  async forSocialAccount(socialAccountId: string): Promise<ProviderCredentials> {
    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId }, include: { connection: true } });
    let connection = account.connection;
    if (connection.status === 'REAUTH_REQUIRED' || connection.status === 'DISCONNECTED' || !connection.accessTokenEnc) throw reauth();

    let accessToken = this.cipher.decrypt(connection.accessTokenEnc, tokenAad('provider_connections', connection.id, 'access_token_enc'));

    const expiring = connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
    const provider = this.providers.byKind(connection.provider);
    if (expiring && connection.refreshTokenEnc && provider?.refresh) {
      const refreshToken = this.cipher.decrypt(connection.refreshTokenEnc, tokenAad('provider_connections', connection.id, 'refresh_token_enc'));
      try {
        const refreshed = await provider.refresh(refreshToken);
        accessToken = refreshed.accessToken;
        const enc = this.cipher.encrypt(accessToken, tokenAad('provider_connections', connection.id, 'access_token_enc'));
        connection = await this.prisma.providerConnection.update({
          where: { id: connection.id },
          data: { accessTokenEnc: enc.data, tokenKeyVersion: enc.keyVersion, accessTokenExpiresAt: refreshed.expiresAt ?? null, lastRefreshedAt: new Date(), status: 'CONNECTED', lastError: null },
        });
      } catch (error) {
        if (error instanceof ProviderAuthRevokedError) {
          await this.prisma.providerConnection.update({ where: { id: connection.id }, data: { status: 'REAUTH_REQUIRED', lastError: 'REFRESH_REVOKED' } });
          await this.prisma.socialAccount.updateMany({ where: { connectionId: connection.id, status: 'ACTIVE' }, data: { status: 'REAUTH_REQUIRED', statusReason: 'Access was revoked' } });
          throw reauth();
        }
        this.logger.warn(`Token refresh failed for connection ${connection.id}: ${(error as Error).message}`);
        throw new ProviderError({ category: 'TRANSIENT', code: 'TOKEN_REFRESH_FAILED', userMessage: 'Could not refresh the connection. Will retry.', requestHadNoEffect: true });
      }
    }

    const destinationToken = account.destinationTokenEnc
      ? this.cipher.decrypt(account.destinationTokenEnc, tokenAad('social_accounts', account.id, 'destination_token_enc'))
      : undefined;
    return { accessToken, destinationToken };
  }
}
