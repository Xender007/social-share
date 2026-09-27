import { Injectable } from '@nestjs/common';
import type { ProviderKind } from '@sp/contracts';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { httpJson } from '../publishers/http';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  externalUserId: string;
  externalUserName?: string;
}

export interface DiscoveredDestination {
  platformCode: string;
  externalAccountId: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  destinationToken?: string;
  eligible: boolean;
  ineligibleReason?: string;
  metadata: Record<string, unknown>;
}

export class ProviderAuthRevokedError extends Error {}

export interface SocialAuthProvider {
  readonly kind: ProviderKind;
  readonly slug: 'google' | 'meta';
  readonly label: string;
  readonly platformCodes: string[];
  readonly usesPkce: boolean;
  buildAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; codeVerifier?: string; redirectUri: string }): Promise<TokenSet>;
  discoverDestinations(tokens: TokenSet): Promise<DiscoveredDestination[]>;
  refresh?(refreshToken: string): Promise<{ accessToken: string; expiresAt?: Date; refreshToken?: string }>;
  validate(tokens: { accessToken: string; refreshToken?: string }): Promise<{ valid: boolean; expiresAt?: Date; reason?: string }>;
}

/** Simulated Google/Meta for PROVIDER_MODE=fake: a local consent page and deterministic demo accounts. */
export class FakeAuthProvider implements SocialAuthProvider {
  readonly usesPkce: boolean;
  readonly platformCodes: string[];
  readonly label: string;

  constructor(
    readonly kind: ProviderKind,
    readonly slug: 'google' | 'meta',
    private readonly apiBaseUrl: string,
  ) {
    this.usesPkce = slug === 'google';
    this.platformCodes = slug === 'google' ? ['youtube'] : ['facebook', 'instagram'];
    this.label = slug === 'google' ? 'YouTube' : 'Instagram & Facebook';
  }

  buildAuthorizationUrl(input: { state: string; redirectUri: string }): string {
    const qs = new URLSearchParams({ state: input.state, redirect_uri: input.redirectUri });
    return `${this.apiBaseUrl}/dev/oauth/${this.slug}?${qs}`;
  }

  async exchangeCode(input: { code: string }): Promise<TokenSet> {
    if (input.code !== 'fake-approved') throw new ProviderAuthRevokedError('Fake provider rejected the code');
    return {
      accessToken: `fake-access-${randomBytes(12).toString('hex')}`,
      refreshToken: this.slug === 'google' ? `fake-refresh-${randomBytes(12).toString('hex')}` : undefined,
      expiresAt: new Date(Date.now() + (this.slug === 'google' ? 3600 : 60 * 86400) * 1000),
      scopes: this.slug === 'google' ? ['youtube.upload', 'youtube.readonly', 'yt-analytics.readonly'] : ['pages_manage_posts', 'instagram_content_publish'],
      externalUserId: `fake-${this.slug}-user`,
      externalUserName: this.slug === 'google' ? 'Demo Google Account' : 'Demo Meta Account',
    };
  }

  async discoverDestinations(): Promise<DiscoveredDestination[]> {
    if (this.slug === 'google') {
      return [{ platformCode: 'youtube', externalAccountId: 'UC_fake_demo_channel', displayName: 'Demo Channel', handle: '@demochannel', eligible: true, metadata: { fake: true } }];
    }
    return [
      { platformCode: 'facebook', externalAccountId: 'fake_page_1001', displayName: 'Demo Page', eligible: true, destinationToken: `fake-page-${randomBytes(8).toString('hex')}`, metadata: { fake: true } },
      {
        platformCode: 'instagram',
        externalAccountId: 'fake_ig_2002',
        displayName: 'Demo Creator',
        handle: '@demo_creator',
        eligible: true,
        destinationToken: `fake-page-${randomBytes(8).toString('hex')}`,
        metadata: { fake: true, pageId: 'fake_page_1001' },
      },
    ];
  }

  async refresh(): Promise<{ accessToken: string; expiresAt?: Date }> {
    return { accessToken: `fake-access-${randomBytes(12).toString('hex')}`, expiresAt: new Date(Date.now() + 3600_000) };
  }

  async validate(): Promise<{ valid: boolean; expiresAt?: Date }> {
    return { valid: true };
  }
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

/** Google OAuth for YouTube (§13.3). The consent screen must be "In production" or refresh tokens expire after 7 days. */
export class GoogleAuthProvider implements SocialAuthProvider {
  readonly kind = 'GOOGLE' as const;
  readonly slug = 'google' as const;
  readonly label = 'YouTube';
  readonly platformCodes = ['youtube'];
  readonly usesPkce = true;

  constructor(private readonly clientId: string, private readonly clientSecret: string) {}

  buildAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): string {
    const qs = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: input.state,
      code_challenge: input.codeChallenge ?? '',
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
  }

  async exchangeCode(input: { code: string; codeVerifier?: string; redirectUri: string }): Promise<TokenSet> {
    const res = await httpJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier ?? '',
      }),
    });
    if (res.status !== 200 || !res.body.access_token) throw new ProviderAuthRevokedError(`Google token exchange failed: ${res.body.error ?? res.status}`);
    const channels = await this.channels(res.body.access_token);
    return {
      accessToken: res.body.access_token,
      refreshToken: res.body.refresh_token,
      expiresAt: res.body.expires_in ? new Date(Date.now() + res.body.expires_in * 1000) : undefined,
      scopes: (res.body.scope ?? '').split(' ').filter(Boolean),
      externalUserId: channels[0]?.id ?? 'google-user',
      externalUserName: channels[0]?.snippet?.title,
    };
  }

  async discoverDestinations(tokens: TokenSet): Promise<DiscoveredDestination[]> {
    return (await this.channels(tokens.accessToken)).map((channel) => ({
      platformCode: 'youtube',
      externalAccountId: channel.id,
      displayName: channel.snippet?.title ?? 'YouTube channel',
      handle: channel.snippet?.customUrl,
      avatarUrl: channel.snippet?.thumbnails?.default?.url,
      eligible: true,
      metadata: { uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads },
    }));
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt?: Date }> {
    const res = await httpJson<{ access_token?: string; expires_in?: number; error?: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    if (res.body.error === 'invalid_grant') throw new ProviderAuthRevokedError('Google access was revoked or expired');
    if (res.status !== 200 || !res.body.access_token) throw new Error(`Google token refresh failed (${res.status})`);
    return { accessToken: res.body.access_token, expiresAt: res.body.expires_in ? new Date(Date.now() + res.body.expires_in * 1000) : undefined };
  }

  async validate(tokens: { accessToken: string; refreshToken?: string }): Promise<{ valid: boolean; expiresAt?: Date; reason?: string }> {
    if (!tokens.refreshToken) return { valid: false, reason: 'NO_REFRESH_TOKEN' };
    try {
      const refreshed = await this.refresh(tokens.refreshToken);
      return { valid: true, expiresAt: refreshed.expiresAt };
    } catch (error) {
      if (error instanceof ProviderAuthRevokedError) return { valid: false, reason: 'REVOKED' };
      throw error;
    }
  }

  private async channels(accessToken: string) {
    const res = await httpJson<{
      items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
    }>('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status !== 200) throw new Error(`Could not list YouTube channels (${res.status})`);
    return res.body.items ?? [];
  }
}

/** Facebook Login for Business: one grant discovers Pages and their linked Instagram professional accounts (§13.4). */
export class MetaAuthProvider implements SocialAuthProvider {
  readonly kind = 'META' as const;
  readonly slug = 'meta' as const;
  readonly label = 'Instagram & Facebook';
  readonly platformCodes = ['facebook', 'instagram'];
  readonly usesPkce = false;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly apiVersion: string,
    private readonly loginConfigId?: string,
  ) {}

  private graph(path: string): string {
    return `https://graph.facebook.com/${this.apiVersion}/${path}`;
  }

  buildAuthorizationUrl(input: { state: string; redirectUri: string }): string {
    const qs = new URLSearchParams({ client_id: this.appId, redirect_uri: input.redirectUri, state: input.state, response_type: 'code' });
    if (this.loginConfigId) qs.set('config_id', this.loginConfigId);
    else qs.set('scope', 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_insights,read_insights');
    return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?${qs}`;
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<TokenSet> {
    const short = await httpJson<{ access_token?: string; error?: { message?: string } }>(
      `${this.graph('oauth/access_token')}?${new URLSearchParams({ client_id: this.appId, client_secret: this.appSecret, redirect_uri: input.redirectUri, code: input.code })}`,
    );
    if (!short.body.access_token) throw new ProviderAuthRevokedError(`Meta code exchange failed: ${short.body.error?.message ?? short.status}`);
    const long = await httpJson<{ access_token?: string; expires_in?: number }>(
      `${this.graph('oauth/access_token')}?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: this.appId, client_secret: this.appSecret, fb_exchange_token: short.body.access_token })}`,
    );
    const accessToken = long.body.access_token ?? short.body.access_token;
    const me = await httpJson<{ id: string; name?: string }>(`${this.graph('me')}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    return {
      accessToken,
      expiresAt: long.body.expires_in ? new Date(Date.now() + long.body.expires_in * 1000) : undefined,
      scopes: [],
      externalUserId: me.body.id,
      externalUserName: me.body.name,
    };
  }

  async discoverDestinations(tokens: TokenSet): Promise<DiscoveredDestination[]> {
    const res = await httpJson<{
      data?: Array<{ id: string; name: string; access_token?: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }>;
    }>(`${this.graph('me/accounts')}?${new URLSearchParams({ fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}', access_token: tokens.accessToken })}`);
    if (res.status !== 200) throw new Error(`Could not list Facebook Pages (${res.status})`);
    const out: DiscoveredDestination[] = [];
    for (const page of res.body.data ?? []) {
      out.push({ platformCode: 'facebook', externalAccountId: page.id, displayName: page.name, avatarUrl: page.picture?.data?.url, destinationToken: page.access_token, eligible: Boolean(page.access_token), ineligibleReason: page.access_token ? undefined : 'Your Page role does not allow publishing.', metadata: {} });
      if (page.instagram_business_account) {
        const ig = page.instagram_business_account;
        out.push({ platformCode: 'instagram', externalAccountId: ig.id, displayName: ig.username ?? page.name, handle: ig.username ? `@${ig.username}` : undefined, avatarUrl: ig.profile_picture_url, destinationToken: page.access_token, eligible: true, metadata: { pageId: page.id } });
      }
    }
    return out;
  }

  async validate(tokens: { accessToken: string }): Promise<{ valid: boolean; expiresAt?: Date; reason?: string }> {
    const res = await httpJson<{ data?: { is_valid?: boolean; expires_at?: number } }>(
      `${this.graph('debug_token')}?${new URLSearchParams({ input_token: tokens.accessToken, access_token: `${this.appId}|${this.appSecret}` })}`,
    );
    const data = res.body.data;
    return { valid: Boolean(data?.is_valid), expiresAt: data?.expires_at ? new Date(data.expires_at * 1000) : undefined, reason: data?.is_valid ? undefined : 'INVALID' };
  }
}

@Injectable()
export class AuthProviderRegistry {
  private readonly providers = new Map<string, SocialAuthProvider>();

  constructor(private readonly config: AppConfig) {
    const env = config.env;
    if (config.isFakeProviders) {
      this.providers.set('google', new FakeAuthProvider('GOOGLE', 'google', env.API_BASE_URL));
      this.providers.set('meta', new FakeAuthProvider('META', 'meta', env.API_BASE_URL));
      return;
    }
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) this.providers.set('google', new GoogleAuthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET));
    if (env.META_APP_ID && env.META_APP_SECRET) {
      this.providers.set('meta', new MetaAuthProvider(env.META_APP_ID, env.META_APP_SECRET, env.META_GRAPH_API_VERSION, env.META_LOGIN_CONFIG_ID));
    }
  }

  bySlug(slug: string): SocialAuthProvider | undefined {
    return this.providers.get(slug);
  }

  byKind(kind: ProviderKind): SocialAuthProvider | undefined {
    return [...this.providers.values()].find((p) => p.kind === kind);
  }

  redirectUri(slug: string): string {
    const env = this.config.env;
    if (!this.config.isFakeProviders) {
      if (slug === 'google' && env.GOOGLE_REDIRECT_URI) return env.GOOGLE_REDIRECT_URI;
      if (slug === 'meta' && env.META_REDIRECT_URI) return env.META_REDIRECT_URI;
    }
    return `${env.API_BASE_URL}/v1/connections/${slug}/callback`;
  }
}
