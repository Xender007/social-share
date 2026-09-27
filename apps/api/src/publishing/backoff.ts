const BASE_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

/**
 * Retry delay for the Nth retry (1-based) with ±20% jitter (§17.5).
 * `random` is injectable for deterministic tests.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_DELAYS_MS[Math.min(Math.max(attempt, 1), BASE_DELAYS_MS.length) - 1];
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}

/** Poll cadence while a provider is processing: 10s, 20s, 30s, 60s, then every 2 minutes. */
export function pollDelayMs(pollCount: number): number {
  const schedule = [10_000, 20_000, 30_000, 60_000];
  return pollCount < schedule.length ? schedule[pollCount] : 120_000;
}
