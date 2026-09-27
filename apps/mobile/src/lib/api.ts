import type {
  AccountMetricsResponse,
  AdminFeatureView,
  AdminOverview,
  AdminPlatformView,
  AnalyticsRange,
  ApiErrorBody,
  AudienceResponse,
  AuditLogView,
  CapabilitiesResponse,
  CompleteUploadRequest,
  ConnectionView,
  CreateKillSwitchRequest,
  CreatePostRequest,
  KillSwitchView,
  MediaResponse,
  MeResponse,
  MetricSeries,
  OverviewResponse,
  PostListResponse,
  PostView,
  PublicationView,
  ResolvePublicationRequest,
  SocialAccountView,
  StartConnectionResponse,
  StartUploadRequest,
  StartUploadResponse,
  TokenResponse,
  TopPostsResponse,
  UpdateMeRequest,
  UploadPartUrl,
} from '@sp/contracts';
import { API_BASE_URL } from './config';
import { queryClient } from './query-client';
import { refreshSession, useSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const { method = 'GET', body, headers = {}, auth = true, signal } = options;
  const session = useSession.getState();
  if (auth && session.accessToken && Date.now() > session.accessTokenExpiresAt) await refreshSession();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && useSession.getState().accessToken ? { Authorization: `Bearer ${useSession.getState().accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Can't reach the server at ${API_BASE_URL}. Check your connection.`);
  }

  if (res.status === 401 && auth && !retried) {
    if (await refreshSession()) return request<T>(path, options, true);
    await useSession.getState().signOut();
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    if (err?.code === 'CAPABILITY_DENIED') void queryClient.invalidateQueries({ queryKey: ['capabilities'] });
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as Array<[string, string | number]>;
  return entries.length ? `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};

export type AdminPublication = PublicationView & { postId: string; postTitle: string | null };
export type AdminConnection = { id: string; provider: string; owner: string; name: string | null; status: string; lastValidatedAt: string | null; accessTokenExpiresAt: string | null; lastError: string | null; accounts: Array<{ id: string; platform: string; name: string; status: string }> };
export type AppSettings = Record<string, string | number>;

export const api = {
  health: () => request<{ status: string; providerMode: string }>('/health', { auth: false }),
  login: (email: string, password: string, deviceName?: string) => request<TokenResponse>('/v1/auth/login', { method: 'POST', body: { email, password, deviceName }, auth: false }),
  me: () => request<MeResponse>('/v1/me'),
  updateMe: (body: UpdateMeRequest) => request<MeResponse>('/v1/me', { method: 'PATCH', body }),
  registerDevice: (expoPushToken: string, appVersion: string) => request<{ id: string }>('/v1/me/devices', { method: 'POST', body: { expoPushToken, appVersion } }),
  capabilities: () => request<CapabilitiesResponse>('/v1/me/capabilities'),

  startConnection: (provider: 'google' | 'meta') => request<StartConnectionResponse>(`/v1/connections/${provider}/start`, { method: 'POST' }),
  connections: () => request<ConnectionView[]>('/v1/connections'),
  socialAccounts: () => request<SocialAccountView[]>('/v1/social-accounts'),
  setDestinations: (connectionId: string, activeSocialAccountIds: string[]) => request<ConnectionView[]>(`/v1/connections/${connectionId}/destinations`, { method: 'PUT', body: { activeSocialAccountIds } }),
  validateConnection: (connectionId: string) => request<ConnectionView[]>(`/v1/connections/${connectionId}/validate`, { method: 'POST' }),
  disconnect: (connectionId: string) => request<void>(`/v1/connections/${connectionId}`, { method: 'DELETE' }),

  startUpload: (body: StartUploadRequest) => request<StartUploadResponse>('/v1/media/uploads', { method: 'POST', body }),
  uploadParts: (mediaId: string, parts: number[]) => request<{ parts: UploadPartUrl[]; expiresAt: string }>(`/v1/media/${mediaId}/upload-parts${qs({ parts: parts.join(',') })}`),
  completeUpload: (mediaId: string, body: CompleteUploadRequest) => request<MediaResponse>(`/v1/media/${mediaId}/complete`, { method: 'POST', body }),
  media: (mediaId: string) => request<MediaResponse>(`/v1/media/${mediaId}`),

  createPost: (body: CreatePostRequest, idempotencyKey: string) => request<PostView>('/v1/posts', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
  posts: (cursor?: string) => request<PostListResponse>(`/v1/posts${qs({ cursor, limit: 20 })}`),
  post: (id: string) => request<PostView>(`/v1/posts/${id}`),
  retryPublication: (id: string) => request<PostView>(`/v1/publications/${id}/retry`, { method: 'POST' }),
  cancelPublication: (id: string) => request<PostView>(`/v1/publications/${id}/cancel`, { method: 'POST' }),
  resolvePublication: (id: string, body: ResolvePublicationRequest) => request<PostView>(`/v1/publications/${id}/resolve`, { method: 'POST', body }),

  overview: (range: AnalyticsRange) => request<OverviewResponse>(`/v1/analytics/overview${qs({ range })}`),
  audience: (range: AnalyticsRange) => request<AudienceResponse>(`/v1/analytics/audience${qs({ range })}`),
  accountMetrics: (id: string, range: AnalyticsRange) => request<AccountMetricsResponse>(`/v1/analytics/accounts/${id}${qs({ range })}`),
  topPosts: (range: AnalyticsRange, sort = 'views') => request<TopPostsResponse>(`/v1/analytics/posts${qs({ range, sort, limit: 10 })}`),
  postMetrics: (id: string) => request<{ postId: string; series: MetricSeries[] }>(`/v1/analytics/posts/${id}`),
  syncAnalytics: () => request<{ accounts: number; syncedAt: string }>('/v1/analytics/sync', { method: 'POST' }),

  admin: {
    overview: () => request<AdminOverview>('/v1/admin/overview'),
    platforms: () => request<AdminPlatformView[]>('/v1/admin/platforms'),
    updatePlatform: (id: string, enabled: boolean, reason?: string) => request<AdminPlatformView[]>(`/v1/admin/platforms/${id}`, { method: 'PATCH', body: { enabled, reason } }),
    updatePlatformFeature: (platformId: string, featureId: string, enabled: boolean) => request<AdminPlatformView[]>(`/v1/admin/platforms/${platformId}/features/${featureId}`, { method: 'PUT', body: { enabled } }),
    features: () => request<AdminFeatureView[]>('/v1/admin/features'),
    updateFeature: (id: string, enabled: boolean, reason?: string) => request<AdminFeatureView[]>(`/v1/admin/features/${id}`, { method: 'PATCH', body: { enabled, reason } }),
    killSwitches: () => request<KillSwitchView[]>('/v1/admin/kill-switches'),
    activateKillSwitch: (body: CreateKillSwitchRequest) => request<KillSwitchView>('/v1/admin/kill-switches', { method: 'POST', body }),
    deactivateKillSwitch: (id: string) => request<KillSwitchView>(`/v1/admin/kill-switches/${id}/deactivate`, { method: 'POST', body: {} }),
    publications: () => request<AdminPublication[]>('/v1/admin/publications'),
    connections: () => request<AdminConnection[]>('/v1/admin/connections'),
    auditLogs: () => request<AuditLogView[]>('/v1/admin/audit-logs?limit=50'),
    settings: () => request<AppSettings>('/v1/admin/settings'),
  },
};

/** Uploads a part to the presigned storage URL; returns the ETag. */
export async function putPart(url: string, body: Uint8Array | ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body: body as BodyInit, signal });
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_PART_FAILED', `Upload failed (${res.status})`);
  const etag = res.headers.get('etag') ?? res.headers.get('ETag');
  if (!etag) throw new ApiError(0, 'UPLOAD_NO_ETAG', 'Storage did not return an ETag');
  return etag;
}
