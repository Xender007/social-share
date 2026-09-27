import { ProviderError } from './types';

export interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
}

/** fetch wrapper that returns status + parsed JSON (when present) and never throws on HTTP errors. */
export async function httpJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<HttpResult<T>> {
  const { timeoutMs = 60_000, ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { ...rest, signal });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  return { status: res.status, headers: res.headers, body: body as T, text };
}

/** Milliseconds until the next midnight in US Pacific time (YouTube quota reset). */
export function msUntilPacificMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000;
  return Math.max(60_000, 24 * 3_600_000 - elapsed + 60_000);
}

export function retryAfterMs(headers: Headers, fallbackMs: number): number {
  const value = headers.get('retry-after');
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : fallbackMs;
}

export const authError = (code: string, message: string) =>
  new ProviderError({ category: 'AUTH', code, userMessage: message, requestHadNoEffect: true });
