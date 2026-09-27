import { httpJson, HttpResult } from '../http';
import { ProviderError } from '../types';

export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

const THROTTLE_CODES = new Set([4, 17, 32, 613]);
const MEDIA_SUBCODES = new Set([2207026, 2207001, 2207003, 2207004, 2207005, 2207006, 2207008, 2207009, 2207010, 2207052, 2207057]);
const PUBLISH_LIMIT_SUBCODES = new Set([2207042]);

/**
 * Maps Graph API errors to classified provider errors (§21.5). Codes are illustrative and kept here,
 * in one place, so they can be updated when Meta changes them. (verify)
 */
export function metaError(res: HttpResult<MetaErrorBody>, platformName: string, options: { nonIdempotent: boolean }): ProviderError {
  const err = res.body?.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const providerCode = [code, subcode].filter((x) => x !== undefined).join('/') || String(res.status);
  const detail = err?.error_user_msg ?? err?.message ?? `HTTP ${res.status}`;
  const base = { httpStatus: res.status, providerCode };

  if (code === 190 || res.status === 401) {
    return new ProviderError({ ...base, category: 'AUTH', code: 'META_TOKEN_INVALID', userMessage: `Reconnect ${platformName} to continue publishing.`, requestHadNoEffect: true });
  }
  if (subcode !== undefined && PUBLISH_LIMIT_SUBCODES.has(subcode)) {
    return new ProviderError({ ...base, category: 'PROVIDER_LIMIT', code: 'IG_PUBLISH_LIMIT', userMessage: `${platformName} daily publishing limit reached.`, retryAfterMs: 3_600_000, requestHadNoEffect: true });
  }
  if ((code !== undefined && (THROTTLE_CODES.has(code) || (code >= 80001 && code <= 80014))) || res.status === 429) {
    return new ProviderError({ ...base, category: 'RATE_LIMITED', code: 'META_THROTTLED', userMessage: `${platformName} is limiting requests. Will retry shortly.`, retryAfterMs: 10 * 60_000, requestHadNoEffect: true });
  }
  if (subcode !== undefined && MEDIA_SUBCODES.has(subcode)) {
    return new ProviderError({ ...base, category: 'MEDIA_INVALID', code: 'META_MEDIA_INVALID', userMessage: `${platformName} couldn't use this video: ${detail}`, requestHadNoEffect: true });
  }
  if (code === 10 || (code !== undefined && code >= 200 && code < 300)) {
    return new ProviderError({ ...base, category: 'PERMISSION', code: 'META_PERMISSION', userMessage: `${platformName} permission missing: ${detail}`, requestHadNoEffect: true });
  }
  if (err?.is_transient || code === 1 || code === 2 || res.status >= 500) {
    return new ProviderError({ ...base, category: 'TRANSIENT', code: 'META_TRANSIENT', userMessage: `${platformName} had a temporary problem. Will retry.`, requestHadNoEffect: !options.nonIdempotent });
  }
  if (code === 100 || res.status === 400) {
    return new ProviderError({ ...base, category: 'VALIDATION', code: 'META_INVALID_PARAMETER', userMessage: `${platformName} rejected the request: ${detail}`, requestHadNoEffect: true });
  }
  return new ProviderError({ ...base, category: 'INTERNAL', code: 'META_UNEXPECTED', userMessage: `Unexpected ${platformName} response: ${detail}`, requestHadNoEffect: !options.nonIdempotent });
}

/** Minimal Graph API client. The API version comes from configuration, never from business logic. */
export class MetaGraphClient {
  constructor(
    private readonly apiVersion: string,
    private readonly platformName: string,
    private readonly baseUrl = 'https://graph.facebook.com',
  ) {}

  url(path: string): string {
    return `${this.baseUrl}/${this.apiVersion}/${path.replace(/^\//, '')}`;
  }

  async get<T>(path: string, params: Record<string, string>, token: string, signal?: AbortSignal): Promise<T> {
    const qs = new URLSearchParams({ ...params, access_token: token });
    const res = await httpJson<T & MetaErrorBody>(`${this.url(path)}?${qs}`, { signal });
    if (res.status !== 200 || res.body?.error) throw metaError(res, this.platformName, { nonIdempotent: false });
    return res.body;
  }

  async post<T>(path: string, params: Record<string, string | number | boolean | undefined>, token: string, options: { signal?: AbortSignal; nonIdempotent?: boolean } = {}): Promise<T> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) form.set(key, String(value));
    form.set('access_token', token);
    const res = await httpJson<T & MetaErrorBody>(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: options.signal,
    });
    if (res.status !== 200 || res.body?.error) throw metaError(res, this.platformName, { nonIdempotent: options.nonIdempotent ?? false });
    return res.body;
  }
}
