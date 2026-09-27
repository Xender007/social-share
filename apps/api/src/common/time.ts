export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);
export const addMinutes = (date: Date, minutes: number): Date => addMs(date, minutes * 60_000);
export const addHours = (date: Date, hours: number): Date => addMs(date, hours * 3_600_000);
export const addDays = (date: Date, days: number): Date => addMs(date, days * 86_400_000);

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** Converts nullable Prisma BigInt byte counts to JSON-safe numbers. */
export const bigToNumber = (value: bigint | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/** Strips undefined and converts bigint so a value is safe for a Prisma Json column. */
export function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v))) as T;
}
